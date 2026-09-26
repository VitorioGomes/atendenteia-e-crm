import type { FastifyInstance } from "fastify";

/**
 * Protecoes que valem para o servidor inteiro (revisao de seguranca de 26/09/2026,
 * antes de o codigo ficar publico).
 */

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Um pedido que muda alguma coisa so vale se vier do proprio CRM.
 *
 * O cookie de sessao e SameSite=Lax, e isso nao basta aqui: o sslip.io nao esta na
 * lista de sufixos publicos (conferido em 26/09/2026), entao para o navegador
 * "1.2.3.4.sslip.io" e o CRM do comprador em "5.6.7.8.sslip.io" sao o MESMO site.
 * Qualquer um cria um endereco desses; uma pagina ali, aberta pelo dono logado,
 * mandaria o cookie junto e poderia desconectar o WhatsApp ou assumir conversas.
 *
 * Duas conferencias, e as duas vem do navegador, que o atacante nao controla:
 * Sec-Fetch-Site (o navegador diz de onde veio o pedido) e Origin (o endereco da
 * pagina que pediu). Pedido sem nenhum dos dois nao veio de uma pagina (curl, doctor)
 * e segue: sem o cookie de sessao ele nao passa do login de qualquer jeito.
 */
export function origemPermitida(pedido: {
  method: string;
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  if (METODOS_SEGUROS.has(pedido.method.toUpperCase())) return true;

  const site = cabecalho(pedido.headers["sec-fetch-site"]);
  if (site === "cross-site" || site === "same-site") return false;

  const origem = cabecalho(pedido.headers.origin);
  if (!origem) return true;
  const host = cabecalho(pedido.headers.host);
  try {
    return Boolean(host) && new URL(origem).host === host;
  } catch {
    return false;
  }
}

function cabecalho(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * Politica de conteudo das telas do CRM: so roda script servido pelo proprio sistema.
 * E uma camada a mais: se um dia algum texto de cliente escapar para o HTML, o
 * navegador nao executa. O estilo precisa de 'unsafe-inline' porque o React escreve
 * `style=` direto nos elementos (largura de barra, posicao na agenda).
 */
export const POLITICA_DE_CONTEUDO = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export async function protegerServidor(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (origemPermitida(req)) return;
    await reply
      .code(403)
      .send({ erro: "Pedido recusado: ele não veio da tela do CRM. Recarregue a página." });
  });

  app.addHook("onSend", async (_req, reply, corpo) => {
    const tipo = String(reply.getHeader("content-type") ?? "");
    // So nas paginas. A rota de arquivos das conversas ja manda a politica dela.
    if (tipo.startsWith("text/html") && !reply.getHeader("content-security-policy")) {
      reply.header("Content-Security-Policy", POLITICA_DE_CONTEUDO);
      reply.header("X-Frame-Options", "DENY");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Referrer-Policy", "same-origin");
    }
    return corpo;
  });
}
