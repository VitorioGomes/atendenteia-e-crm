import type { Appointment } from "@prisma/client";
import { DateTime } from "luxon";
import { getNegocio, type ConfigNegocio } from "../config/negocio.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { cancelarFollowup } from "../atendimento/followup.js";
import { formatarSlot, horarioEhValido } from "./slots.js";

/**
 * Regras de agendamento — usadas TANTO pela IA quanto pelas telas do CRM.
 *
 * Existe um motivo forte para isso viver num lugar so: se a IA validasse de um
 * jeito e o CRM de outro, o dono marcaria em cima do horario que a IA acabou de
 * vender, ou vice-versa. Uma validacao, dois chamadores.
 */

export type Resultado =
  | { ok: true; agendamento: Appointment }
  | { ok: false; motivo: string };

const chaveLembrete = (agendamentoId: string) => `lembrete:${agendamentoId}`;

export function duracaoDoServico(config: ConfigNegocio, nomeServico: string): number {
  const servico = config.negocio.servicos.find(
    (s) => s.nome.toLowerCase() === nomeServico.toLowerCase(),
  );
  return servico?.duracaoMin ?? config.negocio.agenda.duracaoPadraoMin;
}

/** Nome canonico do servico, quando o que veio parecer com algum cadastrado. */
export function nomeDoServico(config: ConfigNegocio, nomeServico: string): string {
  const servico = config.negocio.servicos.find(
    (s) => s.nome.toLowerCase() === nomeServico.toLowerCase(),
  );
  return servico?.nome ?? nomeServico;
}

// ---------------------------------------------------------------------------
// Lembrete
// ---------------------------------------------------------------------------

/**
 * Agenda (ou reagenda) o lembrete do compromisso.
 *
 * Como todo agendamento passa por aqui, remarcar move o lembrete junto — o erro
 * classico de mandar "seu horario e amanha as 10h" depois de a pessoa ter
 * remarcado nao acontece.
 */
export async function agendarLembrete(
  config: ConfigNegocio,
  agendamento: Appointment,
): Promise<void> {
  const cfg = config.negocio.agenda.lembrete;
  await cancelarLembrete(agendamento.id);

  if (!cfg.ativo) return;
  if (agendamento.status !== "SCHEDULED" && agendamento.status !== "CONFIRMED") return;

  const quandoAvisar = new Date(
    agendamento.scheduledAt.getTime() - cfg.horasAntes * 3_600_000,
  );

  // Compromisso marcado para daqui a 2 horas com lembrete de 24h: nao ha
  // lembrete possivel, e mandar agora seria estranho.
  if (quandoAvisar.getTime() <= Date.now()) return;

  await db.job.create({
    data: {
      type: "lembrete",
      runAt: quandoAvisar,
      dedupeKey: chaveLembrete(agendamento.id),
      payload: { agendamentoId: agendamento.id },
    },
  });

  logger.debug({ agendamentoId: agendamento.id, quandoAvisar }, "lembrete agendado");
}

export async function cancelarLembrete(agendamentoId: string): Promise<void> {
  await db.job
    .deleteMany({ where: { dedupeKey: chaveLembrete(agendamentoId) } })
    .catch((e) => logger.warn({ err: e, agendamentoId }, "falha ao cancelar lembrete"));
}

// ---------------------------------------------------------------------------
// Criar, remarcar, cancelar
// ---------------------------------------------------------------------------

export async function criarAgendamento(
  config: ConfigNegocio,
  dados: {
    contatoId: string;
    negocioId?: string | null;
    servico: string;
    quando: DateTime;
    observacao?: string | null;
    autor: "ia" | "humano";
  },
): Promise<Resultado> {
  if (!config.negocio.agenda.ativo) {
    return { ok: false, motivo: "a agenda esta desligada na configuracao do negocio." };
  }
  if (!dados.quando.isValid) {
    return { ok: false, motivo: "a data informada nao e valida." };
  }

  const servico = nomeDoServico(config, dados.servico);
  const duracao = duracaoDoServico(config, dados.servico);

  const validacao = await horarioEhValido(config.negocio, dados.quando, duracao, {
    regrasDaIa: dados.autor === "ia",
  });
  if (!validacao.ok) return { ok: false, motivo: validacao.motivo };

  const agendamento = await db.appointment.create({
    data: {
      contactId: dados.contatoId,
      dealId: dados.negocioId ?? null,
      service: servico,
      scheduledAt: dados.quando.toJSDate(),
      durationMin: duracao,
      notes: dados.observacao ?? null,
      createdBy: dados.autor,
    },
  });

  await registrarNaTimeline(
    agendamento.dealId,
    `Agendado: ${servico} em ${formatarSlot(dados.quando)}`,
    dados.autor,
  );

  await agendarLembrete(config, agendamento);
  await levarParaEstagioDeAgendamento(config, agendamento.dealId, dados.autor);
  return { ok: true, agendamento };
}

export async function remarcarAgendamento(
  config: ConfigNegocio,
  agendamentoId: string,
  novaData: DateTime,
  autor: "ia" | "humano",
): Promise<Resultado> {
  const atual = await db.appointment.findUnique({ where: { id: agendamentoId } });
  if (!atual) return { ok: false, motivo: "nao encontrei esse agendamento." };
  if (atual.status === "CANCELED") {
    return { ok: false, motivo: "esse agendamento foi cancelado; marque um novo." };
  }
  if (!novaData.isValid) return { ok: false, motivo: "a data informada nao e valida." };

  const validacao = await horarioEhValido(config.negocio, novaData, atual.durationMin, {
    ignorarAgendamentoId: agendamentoId,
    regrasDaIa: autor === "ia",
  });
  if (!validacao.ok) return { ok: false, motivo: validacao.motivo };

  const anterior = DateTime.fromJSDate(atual.scheduledAt).setZone(
    config.negocio.horarios.timezone,
  );

  const agendamento = await db.appointment.update({
    where: { id: agendamentoId },
    data: {
      scheduledAt: novaData.toJSDate(),
      status: "SCHEDULED",
      // Data nova, lembrete novo: o antigo ja nao vale.
      remindedAt: null,
    },
  });

  await registrarNaTimeline(
    agendamento.dealId,
    `Remarcado: ${agendamento.service} de ${formatarSlot(anterior)} para ${formatarSlot(novaData)}`,
    autor,
  );

  await agendarLembrete(config, agendamento);
  return { ok: true, agendamento };
}

export async function cancelarAgendamento(
  agendamentoId: string,
  motivo: string | null,
  autor: "ia" | "humano",
): Promise<Resultado> {
  const atual = await db.appointment.findUnique({ where: { id: agendamentoId } });
  if (!atual) return { ok: false, motivo: "nao encontrei esse agendamento." };
  if (atual.status === "CANCELED") {
    return { ok: false, motivo: "esse agendamento ja estava cancelado." };
  }

  const agendamento = await db.appointment.update({
    where: { id: agendamentoId },
    data: { status: "CANCELED", notes: motivo ?? atual.notes },
  });

  await cancelarLembrete(agendamentoId);
  await registrarNaTimeline(
    agendamento.dealId,
    `Cancelado: ${agendamento.service}${motivo ? ` — ${motivo}` : ""}`,
    autor,
  );
  await tirarDoEstagioDeAgendamento(getNegocio(), agendamento.dealId, autor);

  return { ok: true, agendamento };
}

/** Proximo compromisso ativo do contato. E o que a IA pode remarcar ou cancelar. */
export async function proximoAgendamento(contatoId: string): Promise<Appointment | null> {
  return db.appointment.findFirst({
    where: {
      contactId: contatoId,
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      scheduledAt: { gte: new Date() },
    },
    orderBy: { scheduledAt: "asc" },
  });
}

async function registrarNaTimeline(
  negocioId: string | null,
  texto: string,
  autor: string,
): Promise<void> {
  if (!negocioId) return;
  await db.dealEvent
    .create({ data: { dealId: negocioId, type: "appointment", body: texto, author: autor } })
    .catch((e) => logger.warn({ err: e }, "falha ao registrar evento de agenda"));
}

// ---------------------------------------------------------------------------
// Card do funil acompanha a agenda
// ---------------------------------------------------------------------------
//
// Regra: o card esta no estagio de "tem horario marcado" SE E SOMENTE SE existe um
// agendamento ativo. Quem garante isso e a agenda, nao a IA.
//
// Antes (ate 18/09/2026) a IA movia o card com mover_estagio seguindo uma frase do
// negocio.json ("quando a avaliacao foi efetivamente marcada"). No primeiro teste real
// ela moveu com o motivo "esta pronto para agendar" — e nenhum agendamento existia.
// O dono olharia o funil e ligaria confirmando uma consulta que nao existe.
//
// Mora aqui, e nao na ferramenta da IA, para valer tambem quando o dono marca pelo CRM.

async function levarParaEstagioDeAgendamento(
  config: ConfigNegocio,
  negocioId: string | null,
  autor: "ia" | "humano",
): Promise<void> {
  if (!negocioId) return;
  const definicao = config.negocio.funil.estagios.find((e) => e.aoAgendar);
  if (!definicao) return;

  try {
    const [destino, negocio] = await Promise.all([
      db.stage.findUnique({ where: { key: definicao.chave } }),
      db.deal.findUnique({ where: { id: negocioId }, include: { stage: true } }),
    ]);
    if (!destino || !negocio || negocio.status !== "OPEN") return;

    // So avanca. Quem ja passou dali (ja compareceu, por exemplo) e marca um retorno
    // nao pode voltar no funil por causa disso.
    if (negocio.stage.position >= destino.position) return;

    await db.$transaction([
      db.deal.update({ where: { id: negocioId }, data: { stageId: destino.id } }),
      db.dealEvent.create({
        data: {
          dealId: negocioId,
          type: "stage_changed",
          body: `${negocio.stage.name} -> ${destino.name}: horario marcado`,
          author: autor,
        },
      }),
    ]);
  } catch (e) {
    // Mover o card e consequencia: o agendamento ja existe e nao pode ser desfeito
    // por causa disso.
    logger.warn({ err: e, negocioId }, "agendou, mas nao consegui mover o card");
  }
}

async function tirarDoEstagioDeAgendamento(
  config: ConfigNegocio,
  negocioId: string | null,
  autor: "ia" | "humano",
): Promise<void> {
  if (!negocioId) return;
  const estagios = config.negocio.funil.estagios;
  const indice = estagios.findIndex((e) => e.aoAgendar);
  if (indice < 0) return;

  try {
    const [atual, negocio] = await Promise.all([
      db.stage.findUnique({ where: { key: estagios[indice]!.chave } }),
      db.deal.findUnique({ where: { id: negocioId } }),
    ]);
    if (!atual || !negocio || negocio.stageId !== atual.id) return;

    // Ainda tem outro horario de pe? Entao continua agendado.
    const outros = await db.appointment.count({
      where: {
        dealId: negocioId,
        status: { in: ["SCHEDULED", "CONFIRMED"] },
        scheduledAt: { gte: new Date() },
      },
    });
    if (outros > 0) return;

    // Volta para o estagio imediatamente anterior que faca sentido: nem de ganho,
    // nem de perdido, nem daqueles que so a equipe move.
    const anterior = estagios
      .slice(0, indice)
      .reverse()
      .find((e) => !e.ganho && !e.perdido && !e.somenteEquipe);
    if (!anterior) return;

    const destino = await db.stage.findUnique({ where: { key: anterior.chave } });
    if (!destino) return;

    await db.$transaction([
      db.deal.update({ where: { id: negocioId }, data: { stageId: destino.id } }),
      db.dealEvent.create({
        data: {
          dealId: negocioId,
          type: "stage_changed",
          body: `${atual.name} -> ${destino.name}: horario cancelado`,
          author: autor,
        },
      }),
    ]);
  } catch (e) {
    logger.warn({ err: e, negocioId }, "cancelou, mas nao consegui voltar o card");
  }
}

// ---------------------------------------------------------------------------
// Desfecho: a pessoa veio ou nao
// ---------------------------------------------------------------------------
//
// Marcar "Compareceu" na Agenda move o card para o estagio com "aoComparecer": true
// (e, se ele for de ganho, o negocio vira ganho). Desfazer a marcacao devolve o card
// ao estagio de agendado. Mesma logica do aoAgendar: quem move o card e a agenda,
// para o funil nunca contar uma historia diferente da agenda.

export async function registrarDesfecho(
  config: ConfigNegocio,
  agendamentoId: string,
  status: "SCHEDULED" | "CONFIRMED" | "DONE" | "NOSHOW",
  autor: "ia" | "humano",
): Promise<void> {
  const agendamento = await db.appointment.findUnique({ where: { id: agendamentoId } });
  if (!agendamento?.dealId) return;
  const negocioId = agendamento.dealId;

  const estagios = config.negocio.funil.estagios;
  const defComparecer = estagios.find((e) => e.aoComparecer);
  if (!defComparecer) return;

  try {
    const [compareceu, negocio] = await Promise.all([
      db.stage.findUnique({ where: { key: defComparecer.chave } }),
      db.deal.findUnique({ where: { id: negocioId }, include: { stage: true } }),
    ]);
    if (!compareceu || !negocio) return;

    if (status === "DONE") {
      // So avanca, e nao mexe em quem ja foi dado como perdido.
      if (negocio.stageId === compareceu.id || negocio.status === "LOST") return;
      if (negocio.stage.position > compareceu.position) return;
      await moverCard(negocioId, negocio.stage.name, compareceu, "compareceu", autor);
      return;
    }

    // Desfez o "compareceu": se o card esta la por causa disso, volta para agendado.
    if (negocio.stageId !== compareceu.id) return;
    const outroDone = await db.appointment.count({
      where: { dealId: negocioId, status: "DONE", id: { not: agendamentoId } },
    });
    if (outroDone > 0) return;

    const defAgendado = estagios.find((e) => e.aoAgendar);
    const destino = defAgendado ? await db.stage.findUnique({ where: { key: defAgendado.chave } }) : null;
    if (!destino) return;
    await moverCard(negocioId, compareceu.name, destino, "marcacao de comparecimento desfeita", autor);
  } catch (e) {
    logger.warn({ err: e, negocioId }, "marcou o desfecho, mas nao consegui mover o card");
  }
}

async function moverCard(
  negocioId: string,
  deNome: string,
  destino: { id: string; name: string; isWon: boolean; isLost: boolean },
  motivo: string,
  autor: "ia" | "humano",
): Promise<void> {
  const status = destino.isWon ? "WON" : destino.isLost ? "LOST" : "OPEN";
  const negocio = await db.deal.update({
    where: { id: negocioId },
    data: { stageId: destino.id, status },
  });
  await db.dealEvent.create({
    data: { dealId: negocioId, type: "stage_changed", body: `${deNome} -> ${destino.name}: ${motivo}`, author: autor },
  });

  // Negocio encerrado: a IA nao pode acordar depois para cutucar quem ja veio.
  if (status !== "OPEN") {
    const conversa = await db.conversation.findFirst({
      where: { contactId: negocio.contactId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (conversa) await cancelarFollowup(conversa.id);
  }
}
