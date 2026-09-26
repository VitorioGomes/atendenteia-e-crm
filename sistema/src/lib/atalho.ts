/**
 * O atalho e o que se digita depois da barra. Sem acento, sem espaco, minusculo:
 * "Preco Clareamento" vira "preco-clareamento". Assim "/preco" acha, com ou sem acento.
 */
export function normalizarAtalho(bruto: string): string {
  return bruto
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // tira o acento que o NFD separou da letra
    .toLowerCase()
    .replace(/^\/+/, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}
