import { DateTime } from "luxon";
import { processarConversa } from "../atendimento/responder.js";
import { temPendencia } from "../atendimento/buffer.js";
import { formatarSlot } from "../agenda/slots.js";
import { getNegocio } from "../config/negocio.js";
import { db } from "./db.js";
import { logger } from "./logger.js";

/**
 * Worker interno. Roda no mesmo processo do servidor - sem Redis, sem segundo container.
 *
 * Faz duas coisas:
 *  1. executa os jobs agendados (follow-up);
 *  2. rede de seguranca: pega conversas que ficaram sem resposta porque o processo
 *     caiu no meio do debounce. Sem isso, um restart no momento errado deixa um lead
 *     no vacuo - e o dono nunca vai saber por que.
 */

const INTERVALO_MS = 20_000;
const MAX_TENTATIVAS = 3;

let rodando = false;
let timer: NodeJS.Timeout | null = null;

async function executarJob(job: { id: string; type: string; payload: unknown }): Promise<void> {
  const dados = (job.payload ?? {}) as Record<string, any>;

  switch (job.type) {
    case "followup": {
      const conversaId = String(dados.conversaId ?? "");
      if (!conversaId) throw new Error("job de follow-up sem conversaId");

      // A pessoa pode ter respondido entre o agendamento e agora.
      const conversa = await db.conversation.findUnique({ where: { id: conversaId } });
      if (!conversa || conversa.mode !== "BOT") return;
      if (conversa.lastInboundAt && conversa.lastOutboundAt && conversa.lastInboundAt > conversa.lastOutboundAt) {
        return;
      }

      await processarConversa(conversaId, {
        followup: {
          tentativa: Number(dados.tentativa ?? 1),
          instrucao: String(dados.instrucao ?? ""),
        },
      });
      return;
    }

    case "lembrete": {
      const agendamentoId = String(dados.agendamentoId ?? "");
      if (!agendamentoId) throw new Error("job de lembrete sem agendamentoId");

      const agendamento = await db.appointment.findUnique({
        where: { id: agendamentoId },
        include: { contact: true },
      });

      // Cancelado ou remarcado no meio do caminho: o lembrete perdeu a validade.
      if (!agendamento) return;
      if (agendamento.status !== "SCHEDULED" && agendamento.status !== "CONFIRMED") return;
      if (agendamento.scheduledAt < new Date()) return;

      const conversa = await db.conversation.findFirst({
        where: { contactId: agendamento.contactId },
        orderBy: { createdAt: "desc" },
      });
      if (!conversa) return;

      const config = getNegocio();
      const quando = DateTime.fromJSDate(agendamento.scheduledAt).setZone(
        config.negocio.horarios.timezone,
      );

      // Marca antes de enviar: se o envio falhar, e melhor a pessoa nao receber
      // lembrete do que receber tres.
      await db.appointment.update({
        where: { id: agendamentoId },
        data: { remindedAt: new Date() },
      });

      await processarConversa(conversa.id, {
        lembrete: {
          servico: agendamento.service,
          quando: formatarSlot(quando),
          instrucao: config.negocio.agenda.lembrete.instrucao,
        },
      });
      return;
    }

    default:
      logger.warn({ tipo: job.type }, "tipo de job desconhecido, ignorado");
  }
}

async function processarJobsPendentes(): Promise<void> {
  const pendentes = await db.job.findMany({
    where: { status: "PENDING", runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
    take: 10,
  });

  for (const job of pendentes) {
    await db.job.update({ where: { id: job.id }, data: { status: "RUNNING" } });

    try {
      await executarJob(job);
      // Job concluido sai da tabela: o dedupeKey precisa ficar livre pro proximo.
      await db.job.delete({ where: { id: job.id } });
    } catch (e) {
      const tentativas = job.attempts + 1;
      const falhou = tentativas >= MAX_TENTATIVAS;

      await db.job.update({
        where: { id: job.id },
        data: {
          status: falhou ? "FAILED" : "PENDING",
          attempts: tentativas,
          lastError: (e as Error).message,
          runAt: new Date(Date.now() + tentativas * 60_000),
        },
      });

      logger.error({ err: e, jobId: job.id, tentativas }, "job falhou");
    }
  }
}

/** Conversas com mensagem recebida e nenhuma resposta - provavelmente perdidas num restart. */
async function recuperarConversasParadas(): Promise<void> {
  const limite = new Date(Date.now() - 3 * 60_000);

  const paradas = await db.conversation.findMany({
    where: {
      mode: "BOT",
      lastInboundAt: { not: null, lte: limite },
      OR: [{ lastOutboundAt: null }, { lastOutboundAt: { lt: db.conversation.fields.lastInboundAt } }],
    },
    take: 5,
    select: { id: true },
  });

  for (const conversa of paradas) {
    if (temPendencia(conversa.id)) continue;
    logger.warn({ conversaId: conversa.id }, "conversa sem resposta detectada, respondendo agora");
    await processarConversa(conversa.id).catch((e) =>
      logger.error({ err: e, conversaId: conversa.id }, "falha ao recuperar conversa"),
    );
  }
}

async function ciclo(): Promise<void> {
  if (rodando) return;
  rodando = true;
  try {
    await processarJobsPendentes();
    await recuperarConversasParadas();
  } catch (e) {
    logger.error({ err: e }, "erro no ciclo do worker");
  } finally {
    rodando = false;
  }
}

export function iniciarWorker(): void {
  if (timer) return;
  timer = setInterval(() => void ciclo(), INTERVALO_MS);
  timer.unref?.();
  logger.info("worker interno iniciado");
}

export function pararWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
