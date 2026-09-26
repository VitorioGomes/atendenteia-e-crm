import { getNegocio } from "../config/negocio.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";

/**
 * Follow-up de lead frio.
 *
 * Decisao de projeto: o follow-up e AUTOMATICO, nao e uma ferramenta que a IA escolhe usar.
 * Modelo esquece; tabela nao. O agendamento e do sistema, o texto e que e escrito pela IA
 * na hora de enviar.
 */

const chaveDe = (conversaId: string) => `followup:${conversaId}`;

export async function agendarFollowup(
  conversaId: string,
  negocioId: string,
  tentativa: number,
): Promise<void> {
  const { negocio } = getNegocio();
  const cfg = negocio.followup;

  if (!cfg.ativo) return;
  if (tentativa > cfg.maxTentativas) return;

  const regra = cfg.tentativas[tentativa - 1];
  if (!regra) return;

  const runAt = new Date(Date.now() + regra.aposHoras * 3600_000);

  await db.job.upsert({
    where: { dedupeKey: chaveDe(conversaId) },
    create: {
      type: "followup",
      runAt,
      dedupeKey: chaveDe(conversaId),
      payload: { conversaId, negocioId, tentativa, instrucao: regra.instrucao },
    },
    update: {
      runAt,
      status: "PENDING",
      attempts: 0,
      lastError: null,
      payload: { conversaId, negocioId, tentativa, instrucao: regra.instrucao },
    },
  });

  logger.debug({ conversaId, tentativa, runAt }, "follow-up agendado");
}

/** A pessoa respondeu: o follow-up perde o sentido e some. */
export async function cancelarFollowup(conversaId: string): Promise<void> {
  await db.job
    .deleteMany({ where: { dedupeKey: chaveDe(conversaId), status: "PENDING" } })
    .catch((e) => logger.warn({ err: e, conversaId }, "falha ao cancelar follow-up"));
}
