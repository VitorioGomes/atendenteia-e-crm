/**
 * Substituto do demo.ts nos builds de producao.
 *
 * O vite.config.ts troca "./demo" por este arquivo quando o modo nao e "demo",
 * para que os dados ficticios da clinica nao viajem dentro do sistema que o
 * comprador instala. Em producao a condicao do api.ts nunca escolhe este objeto.
 */
export const apiDemo = null as never;
