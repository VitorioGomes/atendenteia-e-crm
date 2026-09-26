import type { TipoMensagem as MessageKind } from "../lib/estados.js";
import { ehGrupo, jidParaTelefone } from "../lib/telefone.js";

/**
 * Traducao da mensagem do WhatsApp para uma forma unica que o resto do sistema entende.
 *
 * Todo formato estranho do WhatsApp morre aqui. Se aparecer um tipo de mensagem novo,
 * e este arquivo que muda - nao a caixa de entrada nem o agente.
 *
 * Continua recebendo o envelope { event, data } que a Evolution mandava, porque ela so
 * repassava o formato do Baileys: conexao.ts embrulha a mensagem do mesmo jeito. Foi o
 * que permitiu trocar a Evolution pelo Baileys sem reescrever o parser nem seus testes.
 */

export interface MensagemRecebida {
  idExterno: string;
  telefone: string;
  pushName: string | null;
  daEquipe: boolean; // fromMe: mandada pelo proprio numero do negocio
  tipo: MessageKind;
  texto: string | null;
  /** Midia em base64. Quem preenche e conexao.ts, que baixa o arquivo ao receber. */
  base64: string | null;
  mimetype: string | null;
  /** Nome original do documento, quando a pessoa manda um. */
  nomeArquivo: string | null;
  /** Tamanho anunciado pelo WhatsApp, antes de baixar. Serve para recusar o enorme. */
  tamanho: number | null;
  recebidaEm: Date;
}

interface EnvelopeWebhook {
  event?: string;
  instance?: string;
  data?: Record<string, any>;
}

const TIPOS: Record<string, MessageKind> = {
  conversation: "TEXT",
  extendedTextMessage: "TEXT",
  audioMessage: "AUDIO",
  imageMessage: "IMAGE",
  videoMessage: "VIDEO",
  documentMessage: "DOCUMENT",
  documentWithCaptionMessage: "DOCUMENT",
  stickerMessage: "STICKER",
  locationMessage: "LOCATION",
  contactMessage: "CONTACT_CARD",
  contactsArrayMessage: "CONTACT_CARD",
};

export function ehEventoDeMensagem(corpo: unknown): boolean {
  const evento = (corpo as EnvelopeWebhook)?.event ?? "";
  return evento.toLowerCase().replace(/_/g, ".") === "messages.upsert";
}

export function interpretarMensagem(corpo: unknown): MensagemRecebida | null {
  const envelope = corpo as EnvelopeWebhook;
  const dados = envelope?.data;
  if (!dados) return null;

  const chave = dados.key ?? {};
  const jid: string = chave.remoteJid ?? "";
  const idExterno: string = chave.id ?? "";
  if (!jid || !idExterno) return null;

  // Grupos ficam de fora na v1: atendimento comercial acontece no privado, e responder
  // em grupo e o caminho mais rapido pro numero ser denunciado.
  if (ehGrupo(jid)) return null;
  if (jid === "status@broadcast") return null;

  // LID: o endereco novo do WhatsApp.
  //
  // Hoje a mensagem pode chegar de "66782463324204@lid" em vez de
  // "5511999999999@s.whatsapp.net". LID e um identificador interno, NAO e telefone —
  // guardar ele como telefone faz o sistema responder para um numero que nao existe.
  // A resposta sai, ganha id, e nunca chega em ninguem. Foi o que aconteceu no
  // primeiro teste real (17/09/2026).
  //
  // O telefone de verdade vem no campo alternativo da chave.
  const jidTelefone = jid.endsWith("@lid") ? (chave.remoteJidAlt ?? "") : jid;
  if (!jidTelefone) return null;

  const mensagem = dados.message ?? {};
  const tipoBruto: string = dados.messageType ?? Object.keys(mensagem)[0] ?? "";
  const tipo = TIPOS[tipoBruto] ?? "UNKNOWN";

  const timestamp = Number(dados.messageTimestamp ?? 0);
  const recebidaEm = timestamp ? new Date(timestamp * 1000) : new Date();

  return {
    idExterno,
    telefone: jidParaTelefone(jidTelefone),
    pushName: dados.pushName ?? null,
    daEquipe: Boolean(chave.fromMe),
    tipo,
    texto: extrairTexto(mensagem, tipo),
    base64: dados.message?.base64 ?? dados.base64 ?? null,
    mimetype: extrairMimetype(mensagem),
    nomeArquivo: documentoDa(mensagem)?.fileName ?? null,
    tamanho: extrairTamanho(mensagem),
    recebidaEm,
  };
}

function extrairTexto(mensagem: Record<string, any>, tipo: MessageKind): string | null {
  const candidatos = [
    mensagem.conversation,
    mensagem.extendedTextMessage?.text,
    mensagem.imageMessage?.caption,
    mensagem.videoMessage?.caption,
    mensagem.documentMessage?.caption,
    mensagem.documentWithCaptionMessage?.message?.documentMessage?.caption,
    mensagem.buttonsResponseMessage?.selectedDisplayText,
    mensagem.listResponseMessage?.title,
    mensagem.templateButtonReplyMessage?.selectedDisplayText,
  ];

  for (const c of candidatos) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  // Sem texto: descreve o que chegou, pro modelo saber reagir em vez de ficar mudo.
  if (tipo === "LOCATION") return "[a pessoa enviou uma localizacao]";
  if (tipo === "CONTACT_CARD") return "[a pessoa enviou um contato]";
  if (tipo === "STICKER") return "[a pessoa enviou uma figurinha]";
  if (tipo === "IMAGE") return "[a pessoa enviou uma imagem sem legenda]";
  if (tipo === "VIDEO") return "[a pessoa enviou um video]";
  if (tipo === "DOCUMENT") return "[a pessoa enviou um documento]";

  return null;
}

/** O documento com legenda vem embrulhado um nivel abaixo. */
function documentoDa(mensagem: Record<string, any>): Record<string, any> | undefined {
  return mensagem.documentMessage ?? mensagem.documentWithCaptionMessage?.message?.documentMessage;
}

function midiaDa(mensagem: Record<string, any>): Record<string, any> | undefined {
  return (
    mensagem.audioMessage ??
    mensagem.imageMessage ??
    mensagem.videoMessage ??
    mensagem.stickerMessage ??
    documentoDa(mensagem)
  );
}

function extrairMimetype(mensagem: Record<string, any>): string | null {
  return midiaDa(mensagem)?.mimetype ?? null;
}

function extrairTamanho(mensagem: Record<string, any>): number | null {
  // O Baileys entrega numero ou Long, conforme a mensagem.
  const bruto = midiaDa(mensagem)?.fileLength;
  if (bruto === undefined || bruto === null) return null;
  const n = Number(String(bruto));
  return Number.isFinite(n) ? n : null;
}
