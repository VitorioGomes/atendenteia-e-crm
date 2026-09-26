import type { FastifyInstance } from "fastify";
import { DateTime } from "luxon";
import { getNegocio } from "../config/negocio.js";
import { db } from "../lib/db.js";
import { env } from "../config/env.js";
import { exigirLogin } from "./api.js";
import { filtroComVoce, filtroPrecisaDeVoce } from "./conversas.js";

/**
 * Painel.
 *
 * Nao e um painel de vaidade. Cada numero aqui existe para responder uma
 * pergunta que o dono do negocio realmente faz:
 *
 *   "chega gente?"          -> leads novos e a serie de 14 dias
 *   "estou perdendo gente?" -> leads esperando resposta
 *   "a IA da conta?"        -> quanto ela resolve sem chamar humano
 *   "vira dinheiro?"        -> agendamentos e taxa de comparecimento
 *   "quanto custa?"         -> consumo da IA
 */
export async function rotasPainel(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", exigirLogin);

  app.get("/api/painel", async () => {
    const config = getNegocio();
    const zona = config.negocio.horarios.timezone;
    const agora = DateTime.now().setZone(zona);

    const inicioDoDia = agora.startOf("day").toJSDate();
    const seteDias = agora.minus({ days: 7 }).toJSDate();
    const trintaDias = agora.minus({ days: 30 }).toJSDate();
    const quatorzeDias = agora.minus({ days: 13 }).startOf("day");

    const [
      totalContatos,
      novosHoje,
      novos7,
      novos30,
      estagios,
      aguardando,
      comHumanoAgora,
      conversas30,
      handoff30,
      mensagens30,
      proximosAgendamentos,
      compareceu30,
      faltou30,
      criadosPelaIa30,
      contatosRecentes,
      uso,
    ] = await Promise.all([
      db.contact.count(),
      db.contact.count({ where: { createdAt: { gte: inicioDoDia } } }),
      db.contact.count({ where: { createdAt: { gte: seteDias } } }),
      db.contact.count({ where: { createdAt: { gte: trintaDias } } }),

      db.stage.findMany({
        orderBy: { position: "asc" },
        include: { _count: { select: { deals: true } } },
      }),

      // Mesma regra da barra lateral e da caixa de entrada (crm/atencao.ts). Se o
      // painel contasse de um jeito e a barra de outro, o dono deixaria de confiar
      // nos dois numeros.
      db.conversation.count({ where: filtroPrecisaDeVoce(new Date()) }),
      db.conversation.count({ where: filtroComVoce(agora.toJSDate()) }),

      db.conversation.count({ where: { createdAt: { gte: trintaDias } } }),
      db.conversation.count({
        where: {
          createdAt: { gte: trintaDias },
          OR: [{ mode: "HUMAN" }, { handoffReason: { not: null } }],
        },
      }),

      db.message.groupBy({
        by: ["author"],
        where: { createdAt: { gte: trintaDias } },
        _count: { _all: true },
      }),

      db.appointment.count({
        where: {
          scheduledAt: { gte: agora.toJSDate(), lte: agora.plus({ days: 7 }).toJSDate() },
          status: { in: ["SCHEDULED", "CONFIRMED"] },
        },
      }),
      db.appointment.count({ where: { scheduledAt: { gte: trintaDias }, status: "DONE" } }),
      db.appointment.count({ where: { scheduledAt: { gte: trintaDias }, status: "NOSHOW" } }),
      db.appointment.count({
        where: { createdAt: { gte: trintaDias }, createdBy: "ia" },
      }),

      db.contact.findMany({
        where: { createdAt: { gte: quatorzeDias.toJSDate() } },
        select: { createdAt: true },
      }),

      db.setting.findUnique({ where: { key: "uso_llm" } }),
    ]);

    // Serie diaria dos ultimos 14 dias, montada em memoria: sao poucos registros
    // e evita SQL cru, que amarraria o sistema a um banco especifico.
    const porDia = new Map<string, number>();
    for (let i = 0; i < 14; i++) {
      porDia.set(quatorzeDias.plus({ days: i }).toFormat("yyyy-LL-dd"), 0);
    }
    for (const contato of contatosRecentes) {
      const chave = DateTime.fromJSDate(contato.createdAt).setZone(zona).toFormat("yyyy-LL-dd");
      if (porDia.has(chave)) porDia.set(chave, (porDia.get(chave) ?? 0) + 1);
    }

    const contarAutor = (autor: string) =>
      mensagens30.find((m) => m.author === autor)?._count._all ?? 0;

    const totalConsultas = compareceu30 + faltou30;
    const contadoresUso = (uso?.value as Record<string, number> | undefined) ?? {};
    const entradaTotal = (contadoresUso.entrada ?? 0) + (contadoresUso.cacheLido ?? 0);

    return {
      contatos: { total: totalContatos, hoje: novosHoje, semana: novos7, mes: novos30 },

      atencao: { aguardandoResposta: aguardando, emAtendimentoHumano: comHumanoAgora },

      funil: estagios.map((e) => ({
        nome: e.name,
        chave: e.key,
        total: e._count.deals,
        ganho: e.isWon,
        perdido: e.isLost,
      })),

      autonomia: {
        conversas30,
        precisaramDeHumano: handoff30,
        // Quanto a IA resolveu sozinha. E o numero que justifica o produto.
        percentualResolvidoPelaIa:
          conversas30 > 0 ? Math.round(((conversas30 - handoff30) / conversas30) * 100) : null,
      },

      mensagens: {
        recebidas: contarAutor("CONTACT"),
        enviadasPelaIa: contarAutor("BOT"),
        enviadasPorHumano: contarAutor("HUMAN"),
      },

      agenda: {
        proximos7Dias: proximosAgendamentos,
        marcadosPelaIa30: criadosPelaIa30,
        compareceu: compareceu30,
        faltou: faltou30,
        percentualComparecimento:
          totalConsultas > 0 ? Math.round((compareceu30 / totalConsultas) * 100) : null,
      },

      serieNovosLeads: [...porDia.entries()].map(([dia, quantidade]) => ({
        dia,
        rotulo: DateTime.fromFormat(dia, "yyyy-LL-dd").toFormat("dd/LL"),
        quantidade,
      })),

      uso: {
        modelo: env.LLM_MODEL,
        chamadas: contadoresUso.chamadas ?? 0,
        tokensEntrada: entradaTotal,
        tokensSaida: contadoresUso.saida ?? 0,
        // Cache baixo multiplica a conta do comprador; o painel mostra o numero.
        aproveitamentoCache:
          entradaTotal > 0 ? Math.round(((contadoresUso.cacheLido ?? 0) / entradaTotal) * 100) : null,
      },
    };
  });
}
