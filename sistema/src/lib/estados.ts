/**
 * Os estados que antes eram `enum` no Prisma.
 *
 * O SQLite nao tem enum, entao no banco eles sao String. Aqui ficam os tipos e as
 * listas de valores validos — e' este arquivo que devolve ao TypeScript a protecao
 * que o enum dava. Ao criar ou renomear um estado, mude aqui E no schema.prisma.
 *
 * Os valores continuam em INGLES e MAIUSCULAS, iguais aos de antes, para o banco de
 * quem ja instalou continuar valendo e para nao ter que reescrever comparacao em todo
 * o codigo.
 */

export const MODOS_CONVERSA = ["BOT", "HUMAN", "CLOSED"] as const;
export type ModoConversa = (typeof MODOS_CONVERSA)[number];

export const DIRECOES_MENSAGEM = ["IN", "OUT"] as const;
export type DirecaoMensagem = (typeof DIRECOES_MENSAGEM)[number];

export const AUTORES_MENSAGEM = ["CONTACT", "BOT", "HUMAN", "SYSTEM"] as const;
export type AutorMensagem = (typeof AUTORES_MENSAGEM)[number];

export const TIPOS_MENSAGEM = [
  "TEXT",
  "AUDIO",
  "IMAGE",
  "DOCUMENT",
  "VIDEO",
  "STICKER",
  "LOCATION",
  "CONTACT_CARD",
  "UNKNOWN",
] as const;
export type TipoMensagem = (typeof TIPOS_MENSAGEM)[number];

export const STATUS_NEGOCIO = ["OPEN", "WON", "LOST"] as const;
export type StatusNegocio = (typeof STATUS_NEGOCIO)[number];

export const STATUS_AGENDAMENTO = [
  "SCHEDULED",
  "CONFIRMED",
  "CANCELED",
  "DONE",
  "NOSHOW",
] as const;
export type StatusAgendamento = (typeof STATUS_AGENDAMENTO)[number];

export const STATUS_JOB = ["PENDING", "RUNNING", "DONE", "FAILED", "CANCELED"] as const;
export type StatusJob = (typeof STATUS_JOB)[number];

/**
 * Le a coluna `tags`, que no SQLite e' Json.
 *
 * Nunca acessar `contato.tags` direto: o Prisma devolve Json cru, que pode ser nulo
 * (contato antigo), pode nao ser array, e pode ter valor que nao e' string. Uma etiqueta
 * quebrada nao pode derrubar o atendimento.
 */
export function lerEtiquetas(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((t): t is string => typeof t === "string" && t.length > 0);
}

/** Converte reais (como o CRM mostra) para centavos (como o banco guarda). */
export function paraCentavos(reais: number | null | undefined): number | null {
  if (reais == null || !Number.isFinite(reais)) return null;
  return Math.round(reais * 100);
}

/** Converte centavos (banco) para reais (API e tela). */
export function paraReais(centavos: number | null | undefined): number | null {
  if (centavos == null) return null;
  return centavos / 100;
}
