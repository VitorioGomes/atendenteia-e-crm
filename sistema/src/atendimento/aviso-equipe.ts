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

/**
 * Pergunta que a IA nao soube responder, sem parar o atendimento (teste 3, 27/09/2026).
 * A IA dizia "vou confirmar com o time e ja te retorno" e ninguem ficava sabendo: o
 * cliente esperava um retorno que nao vinha. Agora o time recebe a pergunta e a IA
 * segue conversando sobre o resto. Decisao do dono: avisar e continuar, nao transferir.
 */
export function textoDaPergunta(dados: {
  atendente: string;
  cliente: string | null;
  telefone: string;
  pergunta: string;
}): string {
  const quem = dados.cliente
    ? `${dados.cliente}, ${formatarTelefone(dados.telefone)}`
    : formatarTelefone(dados.telefone);
  return [
    `${dados.atendente} não soube responder uma pergunta e disse que o time vai confirmar.`,
    "",
    `Cliente: ${quem}`,
    `Pergunta: ${dados.pergunta}`,
    "",
    "A IA continua atendendo essa pessoa. Responda a pergunta pelo CRM, em Conversas, ou pelo WhatsApp do atendimento.",
  ].join("\n");
}

/**
 * A IA prometeu confirmar com o time? E a rede de seguranca do teste 3: a instrucao
 * mandava chamar a ferramenta junto com a promessa, e ela fez so a metade. Se o texto
 * que vai para o cliente promete um retorno do time e nenhuma ferramenta avisou
 * ninguem, o proprio sistema avisa.
 */
export function prometeuRetornoDoTime(texto: string): boolean {
  const simples = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  const verbos = ["confirmar", "confirmo", "verificar", "verifico", "checar", "consultar", "perguntar"];
  const quem = ["com o time", "com a equipe", "com o pessoal", "com o responsavel", "com a dona", "com o dono"];
  return verbos.some((v) => quem.some((q) => simples.includes(`${v} ${q}`) || simples.includes(`${v} isso ${q}`)));
}
