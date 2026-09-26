import type { Prisma } from "@prisma/client";

/**
 * Como uma mensagem sai para a tela. Painel do lead e caixa de entrada usam a mesma
 * forma — mesma conversa, mesma aparencia.
 */

export const SELECAO_MENSAGEM = {
  id: true,
  direction: true,
  author: true,
  kind: true,
  text: true,
  transcript: true,
  createdAt: true,
  mediaPath: true,
  mediaMime: true,
  mediaName: true,
  mediaSize: true,
} satisfies Prisma.MessageSelect;

type MensagemDoBanco = Prisma.MessageGetPayload<{ select: typeof SELECAO_MENSAGEM }>;

/**
 * "[a pessoa enviou uma imagem sem legenda]" existe para a IA saber o que chegou.
 * Na tela, a propria imagem ja diz isso — o aviso some quando o arquivo esta la.
 */
export function ehAvisoParaIa(texto: string | null): boolean {
  return Boolean(texto && /^\[[^\]]*\]$/.test(texto.trim()));
}

export function mensagemParaTela(m: MensagemDoBanco) {
  const temArquivo = Boolean(m.mediaPath);
  return {
    id: m.id,
    direction: m.direction,
    author: m.author,
    kind: m.kind,
    text: temArquivo && ehAvisoParaIa(m.text) ? null : m.text,
    // Sem transcricao, o que fica gravado e uma instrucao para a IA pedir texto. Com o
    // audio tocando na tela, ela so atrapalharia.
    transcript: temArquivo && ehAvisoParaIa(m.transcript) ? null : m.transcript,
    createdAt: m.createdAt,
    midia: temArquivo
      ? {
          url: `/api/midia/${m.id}`,
          mime: m.mediaMime ?? "application/octet-stream",
          nome: m.mediaName,
          tamanho: m.mediaSize,
        }
      : null,
  };
}

/** Previa da ultima mensagem na lista de conversas. */
export function previaDaMensagem(m: { kind: string; text: string | null }): string {
  const legenda = ehAvisoParaIa(m.text) ? "" : (m.text ?? "");
  const rotulo: Record<string, string> = {
    AUDIO: "Áudio",
    IMAGE: "Foto",
    VIDEO: "Vídeo",
    DOCUMENT: "Documento",
    STICKER: "Figurinha",
  };
  if (m.kind === "AUDIO") return "Áudio";
  if (rotulo[m.kind]) return legenda ? `${rotulo[m.kind]}: ${legenda}` : rotulo[m.kind]!;
  return legenda || (m.text ?? "");
}
