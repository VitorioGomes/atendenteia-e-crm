import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TipoMensagem } from "./estados.js";

/**
 * Arquivos das conversas: fotos, audios, videos e documentos.
 *
 * Ficam em dados/midia/, ao lado do banco — o backup ja copia a pasta dados/ inteira,
 * entao nada novo para configurar. No banco vai so o nome do arquivo, nunca o caminho
 * completo: a pasta e outra no PC e na VPS.
 */

export const PASTA_MIDIA = path.resolve(process.cwd(), "dados", "midia");

/**
 * Limite de envio pelo CRM. O WhatsApp aceita mais em documento, mas 16 MB e o teto
 * de foto e video nele, e arquivo maior que isso vira espera longa na VPS pequena.
 */
export const LIMITE_BYTES = 16 * 1024 * 1024;

const EXTENSOES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "application/pdf": "pdf",
};

/** "audio/ogg; codecs=opus" vira "audio/ogg". */
export function mimeBase(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0]!.trim().toLowerCase();
}

/** Que tipo de mensagem do WhatsApp um arquivo vira. */
export function tipoDoArquivo(mime: string): TipoMensagem {
  const base = mimeBase(mime);
  // SVG e imagem para o navegador, mas o WhatsApp nao mostra: vai como documento.
  if (base.startsWith("image/") && base !== "image/svg+xml") return "IMAGE";
  if (base.startsWith("video/")) return "VIDEO";
  if (base.startsWith("audio/")) return "AUDIO";
  return "DOCUMENT";
}

/**
 * Nome de arquivo que chega de fora (do navegador ou do WhatsApp). Tira caminho e
 * caractere de controle; o resto do nome — acentos inclusive — e da pessoa.
 */
export function limparNomeArquivo(nome: string | null | undefined): string | null {
  const limpo = (nome ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\x00-\x1f\x7f"]/g, "")
    .trim()
    .slice(0, 200);
  return limpo || null;
}

export interface MidiaSalva {
  arquivo: string;
  mime: string;
  tamanho: number;
}

export async function salvarMidia(
  conteudo: Buffer,
  mime: string,
  nomeOriginal?: string | null,
): Promise<MidiaSalva> {
  await mkdir(PASTA_MIDIA, { recursive: true });

  const base = mimeBase(mime) || "application/octet-stream";
  const extensaoDoNome = path.extname(nomeOriginal ?? "").slice(1).toLowerCase();
  const extensao = EXTENSOES[base] ?? (/^[a-z0-9]{1,8}$/.test(extensaoDoNome) ? extensaoDoNome : "bin");

  // Nome sorteado: nunca vem de fora, entao nao ha como apontar para fora da pasta.
  const arquivo = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}.${extensao}`;
  await writeFile(path.join(PASTA_MIDIA, arquivo), conteudo);

  return { arquivo, mime: base, tamanho: conteudo.length };
}

/**
 * Caminho no disco de um arquivo registrado no banco. Devolve null se o nome tentar
 * sair da pasta — o banco e nosso, mas nao custa.
 */
export function caminhoDaMidia(arquivo: string): string | null {
  if (!/^[a-z0-9-]+\.[a-z0-9]{1,8}$/i.test(arquivo)) return null;
  return path.join(PASTA_MIDIA, arquivo);
}
