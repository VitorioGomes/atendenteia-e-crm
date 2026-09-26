import { formatarTelefone, normalizarTelefone, variantesTelefone } from "../lib/telefone.js";

/**
 * Aviso no WhatsApp de quem atende quando a IA passa a conversa.
 *
 * Achado do dono no segundo teste (22/09/2026): a IA "chamava a equipe", o CRM marcava
 * a conversa, e nada mais acontecia. Com o CRM fechado, o cliente ficava esperando
 * alguem que nunca soube que era esperado. O aviso sai do numero do atendimento para o
 * numero pessoal configurado em handoff.avisarNoWhatsapp.
 *
 * Funcoes puras aqui; quem envia e o responder.
 */

/** Numero do aviso normalizado, ou null quando nao ha aviso configurado. */
export function numeroDoAviso(configurado: string): string | null {
  const numero = normalizarTelefone(configurado);
  return numero.length >= 10 ? numero : null;
}

/**
 * Mensagem que chega do numero do aviso e o dono respondendo ao aviso, nao um cliente.
 * Sem isso, o "ok, vou ver" dele viraria lead e a IA responderia o proprio dono.
 */
export function ehNumeroDoAviso(telefone: string, configurado: string): boolean {
  const aviso = numeroDoAviso(configurado);
  if (!aviso) return false;
  const deQuemChegou = new Set(variantesTelefone(telefone));
  return variantesTelefone(aviso).some((v) => deQuemChegou.has(v));
}

export function textoDoAviso(dados: {
  atendente: string;
  cliente: string | null;
  telefone: string;
  motivo: string | null;
}): string {
  const quem = dados.cliente
    ? `${dados.cliente}, ${formatarTelefone(dados.telefone)}`
    : formatarTelefone(dados.telefone);
  const linhas = [`${dados.atendente} precisa de você numa conversa.`, "", `Cliente: ${quem}`];
  if (dados.motivo) linhas.push(`Motivo: ${dados.motivo}`);
  linhas.push(
    "",
    "A IA parou de responder essa pessoa. Responda pelo CRM, em Conversas, ou pelo WhatsApp do atendimento.",
  );
  return linhas.join("\n");
}
