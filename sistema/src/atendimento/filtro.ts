import type { MensagemRecebida } from "../whatsapp/payload.js";

/**
 * Filtro de entrada: o que e conversa e o que e ruido do WhatsApp.
 *
 * Fica num arquivo proprio, sem tocar em banco nem em configuracao, para poder ser
 * testado sozinho — a caixa de entrada inteira arrasta o .env junto.
 */

/**
 * Idade maxima de uma mensagem para o sistema reagir a ela.
 *
 * Ao conectar, o WhatsApp entrega o que ficou pendente — inclusive conversa velha do
 * numero. Sem este teto, ligar o atendente num chip que ja era usado faria a IA
 * responder gente que escreveu semana passada, como se fosse agora.
 *
 * O teto e generoso de proposito: mensagem de ontem a noite ainda merece resposta.
 */
const IDADE_MAXIMA_MS = 24 * 60 * 60 * 1000;

/**
 * Decide se a mensagem merece virar atendimento. Devolve o motivo de ignorar, ou
 * null quando deve seguir.
 *
 * Esta funcao existe separada para poder ser testada sem banco: os dois motivos
 * abaixo so apareceram no primeiro teste com WhatsApp de verdade, e sao o tipo de
 * defeito que volta em silencio numa refatoracao.
 */
export function motivoParaIgnorar(
  msg: MensagemRecebida,
  agora: Date = new Date(),
): "sem-conteudo" | "antiga" | null {
  // O WhatsApp manda muita coisa que nao e conversa: aviso de sincronizacao, chave
  // de criptografia, reacao, mensagem apagada. Audio conta como conteudo mesmo sem
  // texto, porque vai ser transcrito.
  if (!msg.texto?.trim() && msg.tipo !== "AUDIO") return "sem-conteudo";

  if (agora.getTime() - msg.recebidaEm.getTime() > IDADE_MAXIMA_MS) return "antiga";

  return null;
}

