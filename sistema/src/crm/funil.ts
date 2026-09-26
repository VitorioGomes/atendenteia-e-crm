import type { ConfigNegocio } from "../config/negocio.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";

/**
 * Espelha o funil do negocio.json dentro do banco, em todo boot.
 *
 * Regra importante: estagio que ficou de fora do negocio.json NAO e apagado se tiver card
 * dentro. Perder lead porque o dono renomeou um estagio seria imperdoavel - ele so some
 * do banco quando estiver vazio.
 */
export async function sincronizarFunil(config: ConfigNegocio): Promise<void> {
  const estagios = config.negocio.funil.estagios;

  for (const [indice, estagio] of estagios.entries()) {
    await db.stage.upsert({
      where: { key: estagio.chave },
      create: {
        key: estagio.chave,
        name: estagio.nome,
        position: indice,
        isWon: estagio.ganho,
        isLost: estagio.perdido,
      },
      update: {
        name: estagio.nome,
        position: indice,
        isWon: estagio.ganho,
        isLost: estagio.perdido,
      },
    });
  }

  const chaves = estagios.map((e) => e.chave);
  const orfaos = await db.stage.findMany({
    where: { key: { notIn: chaves } },
    include: { _count: { select: { deals: true } } },
  });

  for (const orfao of orfaos) {
    if (orfao._count.deals === 0) {
      await db.stage.delete({ where: { id: orfao.id } });
      logger.info({ estagio: orfao.key }, "estagio removido do funil (estava vazio)");
    } else {
      logger.warn(
        { estagio: orfao.key, cards: orfao._count.deals },
        "estagio saiu do negocio.json mas ainda tem cards - foi mantido para nao perder lead",
      );
    }
  }
}
