import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { registrarProcessador } from "./atendimento/buffer.js";
import { processarConversa } from "./atendimento/responder.js";
import { env, urlPublica } from "./config/env.js";
import { ErroDeConfiguracao, carregarNegocio } from "./config/negocio.js";
import { garantirUsuario } from "./crm/auth.js";
import { sincronizarFunil } from "./crm/funil.js";
import { fecharDb } from "./lib/db.js";
import { logger } from "./lib/logger.js";
import { iniciarWorker, pararWorker } from "./lib/worker.js";
import { rotasApi } from "./http/api.js";
import { rotasCrm } from "./http/crm.js";
import { rotasContatos } from "./http/contatos.js";
import { rotasConversas } from "./http/conversas.js";
import { rotasMidia } from "./http/midia.js";
import { rotasRespostasRapidas } from "./http/respostas-rapidas.js";
import { semearRespostasRapidas } from "./crm/respostas-rapidas.js";
import { rotasPainel } from "./http/painel.js";
import { protegerServidor } from "./http/seguranca.js";
import { prepararConexao } from "./whatsapp/conexao.js";

async function iniciar(): Promise<void> {
  // 1. Configuracao do negocio. Sem isso nada faz sentido, entao para aqui mesmo.
  let config;
  try {
    config = await carregarNegocio();
  } catch (e) {
    if (e instanceof ErroDeConfiguracao) {
      console.error(`\n${"=".repeat(70)}\n ${e.message}\n${"=".repeat(70)}\n`);
      process.exit(1);
    }
    throw e;
  }

  logger.info(
    { negocio: config.negocio.negocio.nome, atendente: config.negocio.atendente.nome },
    "configuracao do negocio carregada",
  );

  // 2. Banco no formato do funil configurado + acesso ao CRM.
  await sincronizarFunil(config);
  await semearRespostasRapidas(config);
  await garantirUsuario();

  // 3. Liga o debounce ao processador de conversas.
  registrarProcessador(processarConversa);

  // 4. Servidor HTTP.
  // Na VPS (producao) o app so e alcancado pelo Caddy, dentro da rede do Docker. No PC
  // nao ha proxy nenhum: o CRM so abre no proprio computador, como prometemos, e ninguem
  // no mesmo Wi-Fi ve a tela de login (revisao de seguranca de 26/09/2026).
  const naVps = env.NODE_ENV === "production";
  const app = Fastify({
    logger: false,
    bodyLimit: 25 * 1024 * 1024,
    // Atras do Caddy: sem isso o limite de tentativas de login veria o IP do proxy
    // em todo mundo e bloquearia o comprador junto com o atacante. Fora dele (no PC),
    // confiar no cabecalho deixaria qualquer um trocar de "IP" a cada tentativa.
    trustProxy: naVps,
  });

  // Antes das rotas: vale para todas (origem do pedido e politica de conteudo).
  await protegerServidor(app);
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rotasApi);
  // Encapsulados: o preHandler de login vale só dentro de cada plugin.
  await app.register(rotasCrm);
  await app.register(rotasContatos);
  await app.register(rotasConversas);
  await app.register(rotasMidia);
  await app.register(rotasRespostasRapidas);
  await app.register(rotasPainel);

  app.get("/saude", async () => ({ ok: true }));

  // O CRM (build do React) e servido pelo mesmo processo, na mesma porta.
  const pastaWeb = path.resolve(env.WEB_DIR);
  await app.register(fastifyStatic, { root: pastaWeb, wildcard: false });

  // Rotas do front (SPA) caem no index.html.
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api")) {
      return reply.code(404).send({ erro: "Rota não encontrada." });
    }
    return reply.sendFile("index.html");
  });

  // "localhost" escuta no 127.0.0.1 e no ::1 (o Windows as vezes resolve para o segundo).
  await app.listen({ port: env.PORT, host: naVps ? "0.0.0.0" : "localhost" });

  logger.info(`CRM disponivel em ${urlPublica}`);

  // 5. WhatsApp. Nao e fatal: o comprador precisa conseguir abrir o CRM e ler o
  //    QR Code mesmo quando a conexao ainda nao subiu.
  try {
    const estado = await prepararConexao();
    logger.info({ estado }, "conexao do WhatsApp iniciada");
    if (estado !== "open") {
      logger.warn(`WhatsApp ainda nao conectado. Abra ${urlPublica} e leia o QR Code.`);
    }
  } catch (e) {
    logger.error(
      { err: e },
      "nao consegui iniciar a conexao do WhatsApp - o CRM abre normalmente, " +
        "rode 'npm run doctor' para diagnosticar",
    );
  }

  // 6. Worker (follow-up e rede de seguranca).
  iniciarWorker();

  const encerrar = async (sinal: string): Promise<void> => {
    logger.info({ sinal }, "encerrando");
    pararWorker();
    await app.close();
    await fecharDb();
    process.exit(0);
  };

  process.on("SIGTERM", () => void encerrar("SIGTERM"));
  process.on("SIGINT", () => void encerrar("SIGINT"));
}

iniciar().catch((e) => {
  logger.error({ err: e }, "falha fatal ao iniciar");
  process.exit(1);
});
