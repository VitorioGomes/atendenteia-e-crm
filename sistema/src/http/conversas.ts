import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { db } from "../lib/db.js";
import { formatarTelefone } from "../lib/telefone.js";
import { precisaDeVoce } from "../crm/atencao.js";
import { exigirLogin } from "./api.js";
import { previaDaMensagem } from "./mensagem.js";

/**
 * Caixa de entrada: as conversas, da mais recente para a mais antiga.
 *
 * O funil organiza por ETAPA de venda; aqui organiza por quem falou por ultimo. E a
 * tela de quem passa o dia atendendo — o funil e a de quem gerencia.
 *
 * As acoes (assumir, devolver para a IA, enviar mensagem) ja existem em crm.ts e
 * servem as duas telas. Aqui so mora a lista.
 */

const LIMITE = 80;

/**
 * O mesmo criterio de crm/atencao.ts, escrito como filtro de banco.
 * Mudou la, muda aqui.
 */
export function filtroPrecisaDeVoce(agora: Date): Prisma.ConversationWhereInput {
  return {
    lastInboundAt: { not: null },
    AND: [
      {
        OR: [
          { lastOutboundAt: null },
          { lastOutboundAt: { lt: db.conversation.fields.lastInboundAt } },
        ],
      },
      {
        OR: [
          { mode: "HUMAN" },
          { botPausedUntil: { gt: agora } },
        ],
      },
    ],
  };
}

/**
 * "Com você": a conversa esta com a equipe, ou a IA foi pausada porque alguem
 * respondeu pelo celular. E o filtro do funil e o selo azul do responsavel, entao
 * as tres coisas contam igual. Quem, entre essas, esta esperando e o laranja.
 */
export function filtroComVoce(agora: Date): Prisma.ConversationWhereInput {
  return { OR: [{ mode: "HUMAN" }, { botPausedUntil: { gt: agora } }] };
}

export async function rotasConversas(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", exigirLogin);

  app.get("/api/conversas", async (req) => {
    const { filtro, busca } = req.query as { filtro?: string; busca?: string };
    const agora = new Date();
    const termo = (busca ?? "").trim();
    const digitos = termo.replace(/\D/g, "");

    const where: Prisma.ConversationWhereInput = {
      // Conversa sem nenhuma mensagem (contato importado, por exemplo) nao e conversa.
      OR: [{ lastInboundAt: { not: null } }, { lastOutboundAt: { not: null } }],
      AND: [
        filtro === "voce" ? filtroComVoce(agora) : {},
        termo
          ? {
              contact: {
                OR: [
                  { name: { contains: termo } },
                  { pushName: { contains: termo } },
                  ...(digitos.length >= 3 ? [{ phone: { contains: digitos } }] : []),
                ],
              },
            }
          : {},
      ],
    };

    const [conversas, total, pendentes, comVoce] = await Promise.all([
      db.conversation.findMany({
        where,
        // updatedAt anda a cada mensagem que entra ou sai: e a ultima atividade.
        orderBy: { updatedAt: "desc" },
        take: LIMITE,
        include: {
          contact: {
            include: {
              deals: {
                orderBy: { updatedAt: "desc" },
                take: 1,
                select: { id: true, stage: { select: { name: true } } },
              },
            },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { text: true, transcript: true, author: true, kind: true, createdAt: true },
          },
        },
      }),
      db.conversation.count({ where }),
      db.conversation.count({ where: filtroPrecisaDeVoce(agora) }),
      db.conversation.count({
        where: {
          OR: [{ lastInboundAt: { not: null } }, { lastOutboundAt: { not: null } }],
          AND: [filtroComVoce(agora)],
        },
      }),
    ]);

    return {
      total,
      mostrando: conversas.length,
      precisamDeVoce: pendentes,
      comVoce,
      conversas: conversas.map((c) => {
        const ultima = c.messages[0];
        const negocio = c.contact.deals[0];
        return {
          id: c.id,
          negocioId: negocio?.id ?? null,
          estagio: negocio?.stage.name ?? null,
          nome: c.contact.name ?? c.contact.pushName ?? null,
          telefone: c.contact.phone,
          telefoneFormatado: formatarTelefone(c.contact.phone),
          modo: c.mode,
          pausado: Boolean(c.botPausedUntil && c.botPausedUntil > agora),
          precisaDeVoce: precisaDeVoce(c, agora),
          esperandoDesde:
            c.lastInboundAt && (!c.lastOutboundAt || c.lastInboundAt > c.lastOutboundAt)
              ? c.lastInboundAt
              : null,
          ultimaMensagem: ultima
            ? {
                texto: previaDaMensagem(ultima),
                autor: ultima.author,
                em: ultima.createdAt,
              }
            : null,
        };
      }),
    };
  });
}
