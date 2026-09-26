import type { ConfigNegocio } from "../config/negocio.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { normalizarAtalho } from "../lib/atalho.js";

/**
 * Carga inicial das respostas rapidas a partir do negocio.json.
 *
 * Roda UMA vez na vida da instalacao. Depois disso a tela manda: se o dono apagou
 * "/preco", reiniciar o sistema nao pode trazer ela de volta — seria o sistema
 * desfazendo o que a pessoa fez. A marca de "ja carreguei" fica em Setting.
 */
const MARCA = "respostas_rapidas_semeadas";

export async function semearRespostasRapidas(config: ConfigNegocio): Promise<void> {
  const jaFeito = await db.setting.findUnique({ where: { key: MARCA } });
  if (jaFeito) return;

  let criadas = 0;
  for (const r of config.negocio.respostasRapidas) {
    const atalho = normalizarAtalho(r.atalho);
    if (!atalho) continue;
    const existe = await db.quickReply.findUnique({ where: { shortcut: atalho } });
    if (existe) continue;
    await db.quickReply.create({ data: { shortcut: atalho, text: r.texto.trim() } });
    criadas++;
  }

  await db.setting.create({ data: { key: MARCA, value: { em: new Date().toISOString(), criadas } } });
  if (criadas) logger.info({ criadas }, "respostas rapidas iniciais carregadas do negocio.json");
}
