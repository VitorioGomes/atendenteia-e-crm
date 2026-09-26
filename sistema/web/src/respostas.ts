/**
 * Preenchimento das respostas rápidas na caixa de entrada. Sem nada de navegador
 * aqui dentro: os testes do servidor importam este arquivo. Quem normaliza o atalho
 * é o servidor (src/lib/atalho.ts), na hora de salvar.
 */

/** Primeiro nome, com a primeira letra maiúscula: "ana PAULA ribeiro" vira "Ana". */
export function primeiroNome(nome: string | null | undefined): string | null {
  const primeiro = (nome ?? "").trim().split(/\s+/)[0];
  if (!primeiro) return null;
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

/**
 * Troca {nome} pelo primeiro nome do contato. Sem nome conhecido, o {nome} some
 * junto com o espaço antes dele: "Oi {nome}, tudo bem?" vira "Oi, tudo bem?",
 * nunca "Oi , tudo bem?" nem "Oi {nome}".
 */
export function preencherResposta(texto: string, nome: string | null | undefined): string {
  const primeiro = primeiroNome(nome);
  if (primeiro) return texto.replace(/\{nome\}/gi, primeiro);
  const sem = texto
    .replace(/[ \t]*\{nome\}/gi, "")
    .replace(/^[,;]\s*/gm, "")
    .replace(/ +([,.!?;])/g, "$1")
    .replace(/[,;]+(?=[.!?,;])/g, "");
  // "{nome}, a avaliação..." sem nome começaria em minúscula.
  return sem.charAt(0).toUpperCase() + sem.slice(1);
}

/**
 * O que está sendo digitado depois de "/" no começo da caixa. Devolve null quando
 * não é um atalho (não começa com barra, ou já tem espaço: virou frase).
 */
export function atalhoDigitado(texto: string): string | null {
  if (!texto.startsWith("/")) return null;
  const resto = texto.slice(1);
  if (/\s/.test(resto)) return null;
  return resto.toLowerCase();
}
