import { z } from "zod";

/**
 * Variaveis de ambiente. Erro aqui e a causa nº 1 de "nao funciona" na instalacao,
 * entao a mensagem tem que dizer exatamente o que fazer, em portugues.
 */
const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  /**
   * Caminho do arquivo do banco (SQLite). Tem padrao de proposito: no computador do
   * comprador ninguem deveria precisar configurar banco nenhum. O caminho e relativo
   * a pasta prisma/, entao "../dados/crm.db" cai em sistema/dados/crm.db.
   */
  DATABASE_URL: z.string().min(1).default("file:../dados/crm.db"),

  ANTHROPIC_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1).default("claude-haiku-4-5"),

  /**
   * Transcricao de audio. OPCIONAL de proposito: a Anthropic nao transcreve audio,
   * entao exigir esta chave seria um segundo cadastro no meio da instalacao.
   * Sem ela, o atendente pede educadamente para a pessoa escrever.
   */
  OPENAI_API_KEY: z.string().optional(),
  TRANSCRICAO_MODELO: z.string().default("whisper-1"),

  TIMEZONE: z.string().min(1).default("America/Sao_Paulo"),

  /** Endereco publico do CRM, ex.: crm.minhaclinica.com.br ou 203.0.113.10.sslip.io */
  DOMINIO: z.string().default(""),

  CRM_EMAIL: z.string().email(),
  // O mesmo minimo da tela de Perfil. Com 6, "123456" passava aqui e seguia junto
  // na mudanca para a VPS, onde o CRM fica aberto na internet.
  CRM_PASSWORD: z.string().min(8),
  SESSION_SECRET: z.string().min(8),

  NEGOCIO_DIR: z.string().default("./negocio"),
  WEB_DIR: z.string().default("./web/dist"),

  /** Segundos de silencio antes da IA responder (junta mensagens picadas). */
  DEBOUNCE_SECONDS: z.coerce.number().int().min(0).max(60).default(8),
  /** Teto: mesmo que a pessoa nao pare de digitar, responde depois disso. */
  DEBOUNCE_MAX_SECONDS: z.coerce.number().int().min(5).max(180).default(30),
});

/** O que dizer ao usuario quando cada variavel faltar ou estiver invalida. */
const AJUDA: Record<string, string> = {
  ANTHROPIC_API_KEY:
    'Falta a chave da IA. Crie em https://console.anthropic.com (menu "API Keys"), ' +
    'copie a chave e coloque em ANTHROPIC_API_KEY no arquivo .env',
  CRM_EMAIL: "Escolha o e-mail que voce vai usar pra entrar no CRM e coloque em CRM_EMAIL no .env",
  CRM_PASSWORD: "Escolha uma senha de pelo menos 8 caracteres em CRM_PASSWORD no .env",
  SESSION_SECRET:
    "SESSION_SECRET precisa ser um texto longo e aleatorio (pelo menos 8 caracteres). " +
    "Pode inventar qualquer coisa, e so nao deixar vazio.",
  DATABASE_URL:
    "DATABASE_URL precisa apontar para o arquivo do banco, no formato file:../dados/crm.db. " +
    "Normalmente nem precisa existir no .env: quando esta em branco, o sistema usa esse padrao.",
};

function abortar(erro: z.ZodError): never {
  const linhas = erro.issues.map((issue) => {
    const campo = String(issue.path[0] ?? "?");
    return `  - ${campo}: ${AJUDA[campo] ?? issue.message}`;
  });

  console.error(
    [
      "",
      "=".repeat(70),
      " NAO FOI POSSIVEL INICIAR: faltam informacoes no arquivo .env",
      "=".repeat(70),
      ...linhas,
      "",
      " Abra o arquivo .env na pasta do sistema, preencha e ligue de novo.",
      " No computador:  npm run pc          |   Na VPS:  docker compose up -d",
      "=".repeat(70),
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const parsed = schema.safeParse(process.env);
if (!parsed.success) abortar(parsed.error);

export const env = parsed.data;

// O Prisma le DATABASE_URL direto do ambiente, sem passar por aqui. Sem esta linha, o
// padrao acima so valia para quem passasse pelo npm run pc (que manda a variavel) e o
// diagnostico no PC dizia que nao achava o banco (revisao geral de 26/09/2026).
process.env.DATABASE_URL ??= env.DATABASE_URL;
export type Env = typeof env;

/**
 * Em producao o CRM esta na internet atras do Caddy, sempre em HTTPS - entao o cookie
 * de sessao tem que ser `secure`. Fora de producao ele viajaria em http e o navegador
 * simplesmente descartaria o cookie, impedindo o login.
 */
export const cookieSeguro = env.NODE_ENV === "production";

/** URL que o comprador digita no navegador. */
export const urlPublica = env.DOMINIO ? `https://${env.DOMINIO}` : `http://localhost:${env.PORT}`;
