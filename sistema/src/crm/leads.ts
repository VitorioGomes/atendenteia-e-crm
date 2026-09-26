import type { Contact, Conversation, Deal, Stage } from "@prisma/client";
import { db } from "../lib/db.js";
import { formatarTelefone, normalizarTelefone, variantesTelefone } from "../lib/telefone.js";

export interface Lead {
  contato: Contact;
  conversa: Conversation;
  negocio: Deal & { stage: Stage };
  novo: boolean;
}

async function primeiroEstagio(): Promise<Stage> {
  const estagio = await db.stage.findFirst({ orderBy: { position: "asc" } });
  if (!estagio) {
    throw new Error(
      "O funil nao foi criado no banco. Isso e feito na inicializacao a partir do negocio.json.",
    );
  }
  return estagio;
}

/**
 * Encontra ou cria contato, conversa e card do CRM para um telefone.
 *
 * A busca considera as variantes com e sem o nono digito - senao a mesma pessoa vira
 * dois contatos e o dono perde a confianca no CRM.
 */
export async function garantirLead(telefone: string, pushName?: string | null): Promise<Lead> {
  const numero = normalizarTelefone(telefone);
  const variantes = variantesTelefone(numero);

  let contato = await db.contact.findFirst({ where: { phone: { in: variantes } } });
  let novo = false;

  if (!contato) {
    contato = await db.contact.create({
      data: { phone: numero, pushName: pushName ?? null },
    });
    novo = true;
  } else if (pushName && contato.pushName !== pushName) {
    contato = await db.contact.update({
      where: { id: contato.id },
      data: { pushName },
    });
  }

  let conversa = await db.conversation.findFirst({
    where: { contactId: contato.id, mode: { not: "CLOSED" } },
    orderBy: { createdAt: "desc" },
  });
  if (!conversa) {
    conversa = await db.conversation.create({ data: { contactId: contato.id } });
  }

  let negocio = await db.deal.findFirst({
    where: { contactId: contato.id, status: "OPEN" },
    orderBy: { createdAt: "desc" },
    include: { stage: true },
  });

  if (!negocio) {
    const estagio = await primeiroEstagio();
    negocio = await db.deal.create({
      data: {
        contactId: contato.id,
        stageId: estagio.id,
        title: contato.name ?? contato.pushName ?? formatarTelefone(numero),
      },
      include: { stage: true },
    });
  }

  return { contato, conversa, negocio, novo };
}
