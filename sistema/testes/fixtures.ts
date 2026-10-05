import "./preparar.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NegocioSchema } from "../src/config/negocio.js";
import type { ConfigNegocio } from "../src/config/negocio.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));

/**
 * Clinica ficticia usada so nos testes. Ate 05/10/2026 ela era o exemplo que a skill
 * copiava, e as regras genericas dela iam parar na configuracao de todo comprador
 * (inclusive "se nao souber, transfira", que contradizia o avisar_equipe). Agora a
 * skill parte do molde vazio, e a clinica mora aqui.
 */
export async function negocioExemplo(): Promise<ConfigNegocio> {
  const json = JSON.parse(await readFile(path.join(aqui, "fixtures", "negocio-clinica.json"), "utf8"));
  const conhecimento = await readFile(path.join(aqui, "fixtures", "conhecimento-clinica.md"), "utf8");
  return { negocio: NegocioSchema.parse(json), conhecimento };
}

/** Webhook da Evolution para mensagem de texto simples. */
export function webhookTexto(texto: string, extras: Record<string, unknown> = {}) {
  return {
    event: "messages.upsert",
    instance: "principal",
    data: {
      key: {
        remoteJid: "5511987654321@s.whatsapp.net",
        fromMe: false,
        id: "3EB0C1D2E3F4A5B6C7D8",
      },
      pushName: "Ana Souza",
      message: { conversation: texto },
      messageType: "conversation",
      messageTimestamp: 1788000000,
      ...extras,
    },
  };
}
