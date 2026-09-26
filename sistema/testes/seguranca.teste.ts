import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { POLITICA_DE_CONTEUDO, origemPermitida, protegerServidor } from "../src/http/seguranca.js";

/**
 * Revisao de seguranca de 26/09/2026, antes de o codigo ficar publico.
 * O caso que motivou: no sslip.io, o CRM de um comprador e a pagina de um atacante
 * sao o "mesmo site" para o navegador, e o cookie SameSite=Lax vai junto.
 */

const pedido = (method: string, headers: Record<string, string>) => ({ method, headers });

describe("so a tela do CRM muda alguma coisa", () => {
  test("pedido do proprio CRM passa", () => {
    assert.equal(
      origemPermitida(
        pedido("POST", {
          host: "5.6.7.8.sslip.io",
          origin: "https://5.6.7.8.sslip.io",
          "sec-fetch-site": "same-origin",
        }),
      ),
      true,
    );
  });

  test("outro endereco do sslip.io e recusado, mesmo sendo 'o mesmo site'", () => {
    assert.equal(
      origemPermitida(
        pedido("POST", {
          host: "5.6.7.8.sslip.io",
          origin: "https://1.2.3.4.sslip.io",
          "sec-fetch-site": "same-site",
        }),
      ),
      false,
    );
    // Navegador antigo, sem Sec-Fetch-Site: a Origin decide.
    assert.equal(
      origemPermitida(pedido("POST", { host: "5.6.7.8.sslip.io", origin: "https://1.2.3.4.sslip.io" })),
      false,
    );
  });

  test("pagina de outro site e recusada", () => {
    assert.equal(
      origemPermitida(pedido("DELETE", { host: "localhost:3000", "sec-fetch-site": "cross-site" })),
      false,
    );
  });

  test("ler nao muda nada: GET passa de qualquer origem", () => {
    assert.equal(
      origemPermitida(pedido("GET", { host: "localhost:3000", "sec-fetch-site": "cross-site" })),
      true,
    );
  });

  test("pedido que nao veio de pagina (curl, doctor) segue para o login decidir", () => {
    assert.equal(origemPermitida(pedido("POST", { host: "localhost:3000" })), true);
  });

  test("origem ilegivel e recusada", () => {
    assert.equal(origemPermitida(pedido("POST", { host: "localhost:3000", origin: "null" })), false);
  });
});

describe("servidor protegido", () => {
  async function servidor() {
    const pasta = mkdtempSync(path.join(tmpdir(), "crm-web-"));
    writeFileSync(path.join(pasta, "index.html"), "<!doctype html><title>CRM</title>");
    const app = Fastify();
    await protegerServidor(app);
    await app.register(fastifyStatic, { root: pasta, wildcard: false });
    app.post("/api/teste", async () => ({ ok: true }));
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith("/api")) return reply.code(404).send({ erro: "Rota nao encontrada." });
      return reply.sendFile("index.html");
    });
    return app;
  }

  test("as telas saem com a politica de conteudo", async () => {
    const app = await servidor();
    const r = await app.inject({ method: "GET", url: "/" });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers["content-security-policy"], POLITICA_DE_CONTEUDO);
    assert.equal(r.headers["x-frame-options"], "DENY");
    // Rota do front (SPA) cai no index.html, tambem com a politica.
    const spa = await app.inject({ method: "GET", url: "/funil" });
    assert.equal(spa.statusCode, 200);
    assert.equal(spa.headers["content-security-policy"], POLITICA_DE_CONTEUDO);
  });

  test("a API nao ganha a politica de pagina", async () => {
    const app = await servidor();
    const r = await app.inject({ method: "POST", url: "/api/teste", headers: { host: "localhost" } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers["content-security-policy"], undefined);
  });

  test("pedido de outro endereco para a API leva 403", async () => {
    const app = await servidor();
    const r = await app.inject({
      method: "POST",
      url: "/api/teste",
      headers: { host: "5.6.7.8.sslip.io", origin: "https://1.2.3.4.sslip.io" },
    });
    assert.equal(r.statusCode, 403);
  });

  test("caminho que tenta sair da pasta nao entrega arquivo de fora", async () => {
    const app = await servidor();
    const r = await app.inject({ method: "GET", url: "/..%2f..%2f..%2fetc%2fpasswd" });
    assert.ok(!String(r.body).includes("root:"), "nao pode vazar arquivo do sistema");
  });
});
