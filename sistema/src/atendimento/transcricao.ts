import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

/**
 * Transcricao de audio.
 *
 * No Brasil, metade dos leads manda audio - sem isso o atendente parece quebrado.
 * Mas a Anthropic nao transcreve audio, entao isso exige uma segunda chave de API.
 * Decisao de produto: a chave e OPCIONAL. Sem ela o atendente pede pra pessoa escrever,
 * em vez de travar a instalacao de quem so quer ver o negocio funcionando.
 */

export const transcricaoDisponivel = (): boolean => Boolean(env.OPENAI_API_KEY);

/** Mensagem usada quando nao da pra ouvir. Educada e sem expor detalhe tecnico. */
export const AVISO_SEM_TRANSCRICAO =
  "[a pessoa enviou um audio, mas voce nao consegue ouvir audios. " +
  "Peca com gentileza que ela escreva ou resuma em texto, sem explicar motivo tecnico]";

export async function transcreverAudio(
  idMensagem: string,
  base64Recebido: string | null,
  mimetype: string | null,
): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;

  // O audio ja vem baixado de conexao.ts: a chave de midia do WhatsApp expira,
  // entao baixar depois nem sempre funciona.
  const base64 = base64Recebido;
  if (!base64) {
    logger.warn({ idMensagem }, "audio sem conteudo para transcrever");
    return null;
  }

  try {
    const binario = Buffer.from(base64, "base64");
    const tipo = mimetype?.split(";")[0] ?? "audio/ogg";
    const extensao = tipo.includes("mpeg") ? "mp3" : tipo.includes("wav") ? "wav" : "ogg";

    const form = new FormData();
    form.append("file", new Blob([binario], { type: tipo }), `audio.${extensao}`);
    form.append("model", env.TRANSCRICAO_MODELO);
    form.append("language", "pt");

    const resposta = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    if (!resposta.ok) {
      logger.error(
        { status: resposta.status, corpo: await resposta.text() },
        "falha na transcricao de audio",
      );
      return null;
    }

    const dados = (await resposta.json()) as { text?: string };
    const texto = dados.text?.trim();
    return texto || null;
  } catch (e) {
    logger.error({ err: e, idMensagem }, "erro ao transcrever audio");
    return null;
  }
}
