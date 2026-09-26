import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

/**
 * Debounce das mensagens que chegam.
 *
 * No WhatsApp a pessoa escreve assim:
 *    "oi"  /  "bom dia"  /  "queria saber sobre lentes"  /  "quanto custa?"
 *
 * Responder cada uma delas custa 4 chamadas de IA e parece um robo desesperado.
 * Entao a gente espera o silencio e responde tudo de uma vez.
 *
 * Fica na memoria de proposito (sem Redis). O worker tem uma rede de seguranca
 * para conversas que ficaram sem resposta se o processo cair no meio.
 */

interface Pendente {
  timer: NodeJS.Timeout;
  primeiraEm: number;
}

const pendentes = new Map<string, Pendente>();

type Processador = (conversaId: string) => Promise<void>;
let processar: Processador | null = null;

export function registrarProcessador(fn: Processador): void {
  processar = fn;
}

export function agendarResposta(conversaId: string): void {
  const agora = Date.now();
  const existente = pendentes.get(conversaId);
  const primeiraEm = existente?.primeiraEm ?? agora;

  if (existente) clearTimeout(existente.timer);

  // Espera o silencio, mas nunca alem do teto: quem digita sem parar tambem merece resposta.
  const esperaNormal = env.DEBOUNCE_SECONDS * 1000;
  const tempoDecorrido = agora - primeiraEm;
  const restanteAteTeto = Math.max(0, env.DEBOUNCE_MAX_SECONDS * 1000 - tempoDecorrido);
  const espera = Math.min(esperaNormal, restanteAteTeto);

  const timer = setTimeout(() => {
    pendentes.delete(conversaId);
    if (!processar) {
      logger.error("nenhum processador registrado para o buffer de mensagens");
      return;
    }
    processar(conversaId).catch((e) =>
      logger.error({ err: e, conversaId }, "falha ao processar conversa"),
    );
  }, espera);

  // Nao segura o processo no shutdown.
  timer.unref?.();

  pendentes.set(conversaId, { timer, primeiraEm });
}

export function cancelarResposta(conversaId: string): void {
  const pendente = pendentes.get(conversaId);
  if (!pendente) return;
  clearTimeout(pendente.timer);
  pendentes.delete(conversaId);
}

export function temPendencia(conversaId: string): boolean {
  return pendentes.has(conversaId);
}
