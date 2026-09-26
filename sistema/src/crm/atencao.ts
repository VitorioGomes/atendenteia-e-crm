/**
 * Quando uma conversa precisa de uma PESSOA.
 *
 * Nao e "tem mensagem sem resposta": com a IA ligada, toda mensagem nova fica sem
 * resposta por alguns segundos (juntando mensagens picadas, "digitando"), e isso nao
 * pede ninguem. Marcar tudo isso de laranja ensinaria o dono a ignorar o laranja.
 *
 * Precisa de gente quando alguem escreveu e ninguem respondeu, E:
 *  - a conversa esta com a equipe (a IA nao vai responder), ou
 *  - a IA esta pausada porque alguem da equipe respondeu pelo celular.
 *
 * Havia um terceiro caso, "a IA passou de 3 minutos sem responder" (sinal de chave
 * sem credito ou erro da IA). Saiu por decisao do dono em 26/09/2026: o laranja
 * passou a significar so "a conversa esta com voce e alguem espera". Consequencia
 * aceita: falha da IA volta a ser silenciosa na tela.
 *
 * Esta regra existe em DOIS lugares: aqui (para cada linha da lista) e como filtro de
 * banco em http/conversas.ts (para contar e filtrar). Mudou aqui, muda la.
 */

export interface EstadoConversa {
  mode: string;
  botPausedUntil: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
}

/** Alguem escreveu e ainda nao recebeu resposta de ninguem. */
export function estaEsperando(c: EstadoConversa): boolean {
  if (!c.lastInboundAt) return false;
  return !c.lastOutboundAt || c.lastInboundAt > c.lastOutboundAt;
}

export function precisaDeVoce(c: EstadoConversa, agora: Date = new Date()): boolean {
  if (!estaEsperando(c)) return false;
  if (c.mode === "HUMAN") return true;
  return Boolean(c.botPausedUntil && c.botPausedUntil > agora);
}
