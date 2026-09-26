/**
 * Precisa ser o PRIMEIRO import de todo arquivo de teste.
 *
 * O src/config/env.ts valida as variaveis no momento do import e encerra o processo
 * se faltar alguma - entao o ambiente tem que estar de pe antes de qualquer outro import.
 */
const padroes: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:teste@localhost:5432/teste",
  EVOLUTION_URL: "http://localhost:8080",
  EVOLUTION_API_KEY: "chave-de-teste",
  APP_INTERNAL_URL: "http://localhost:3000",
  ANTHROPIC_API_KEY: "chave-de-teste",
  CRM_EMAIL: "teste@exemplo.com",
  CRM_PASSWORD: "senha-de-teste",
  SESSION_SECRET: "segredo-de-teste-bem-longo",
};

for (const [chave, valor] of Object.entries(padroes)) {
  process.env[chave] ??= valor;
}

export {};
