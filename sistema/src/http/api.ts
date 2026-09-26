import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  conferirSenha,
  criarSessao,
  encerrarSessao,
  gerarHash,
  validarSessao,
} from "../crm/auth.js";
import { cookieSeguro, env } from "../config/env.js";
import { getNegocio } from "../config/negocio.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import {
  conectar,
  contaConectada,
  desconectar,
  estadoConexao,
  obterQrCode,
  motivoDaParada,
} from "../whatsapp/conexao.js";
import { formatarTelefone } from "../lib/telefone.js";

const COOKIE = "sessao";

declare module "fastify" {
  interface FastifyRequest {
    usuarioId?: string;
  }
}

/**
 * Limite de tentativas de login.
 *
 * O CRM fica numa VPS, exposto na internet: a tela de login leva varredura automatizada
 * no primeiro dia. Sem isso, a senha do comprador vira questao de tempo.
 * Memoria basta - e um processo so, e reiniciar zerar o contador nao e problema.
 */
const JANELA_MS = 15 * 60_000;
const MAX_TENTATIVAS = 8;
const tentativas = new Map<string, { contagem: number; expiraEm: number }>();

function registrarTentativa(chave: string): void {
  const agora = Date.now();
  const atual = tentativas.get(chave);
  if (!atual || atual.expiraEm < agora) {
    tentativas.set(chave, { contagem: 1, expiraEm: agora + JANELA_MS });
    return;
  }
  atual.contagem += 1;
}

function bloqueado(chave: string): boolean {
  const atual = tentativas.get(chave);
  if (!atual) return false;
  if (atual.expiraEm < Date.now()) {
    tentativas.delete(chave);
    return false;
  }
  return atual.contagem >= MAX_TENTATIVAS;
}

function limparTentativas(chave: string): void {
  tentativas.delete(chave);
}

// Faxina periodica para o mapa nao crescer sem limite sob ataque.
setInterval(() => {
  const agora = Date.now();
  for (const [chave, valor] of tentativas) {
    if (valor.expiraEm < agora) tentativas.delete(chave);
  }
}, JANELA_MS).unref?.();

/** Hash descartavel, gerado uma vez, so para o login levar o mesmo tempo sem usuario. */
let hashFalso: Promise<string> | null = null;
const hashDeComparacao = () => (hashFalso ??= gerarHash(randomBytes(16).toString("hex")));

async function exigirLogin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[COOKIE];
  const usuarioId = await validarSessao(token);
  if (!usuarioId) {
    await reply.code(401).send({ erro: "Sessão expirada. Entre novamente." });
    return;
  }
  req.usuarioId = usuarioId;
}

export async function rotasApi(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Sessao
  // -------------------------------------------------------------------------

  app.post("/api/entrar", async (req, reply) => {
    const origem = req.ip;

    if (bloqueado(origem)) {
      return reply.code(429).send({
        erro: "Muitas tentativas de acesso. Espere 15 minutos e tente de novo.",
      });
    }

    const corpo = z
      .object({ email: z.string(), senha: z.string() })
      .safeParse(req.body);

    if (!corpo.success) return reply.code(400).send({ erro: "Informe e-mail e senha." });

    const usuario = await db.user.findUnique({
      where: { email: corpo.data.email.toLowerCase().trim() },
    });

    // Mesma mensagem nos dois casos, para nao revelar quais e-mails existem. E o mesmo
    // tempo: sem usuario, confere a senha contra um hash qualquer, senao o e-mail errado
    // responderia mais rapido e daria para descobrir o certo pelo relogio.
    const invalido = { erro: "E-mail ou senha incorretos." };
    const senhaConfere = await conferirSenha(
      corpo.data.senha,
      usuario?.passwordHash ?? (await hashDeComparacao()),
    );
    if (!usuario || !senhaConfere) {
      registrarTentativa(origem);
      logger.warn({ origem }, "tentativa de login recusada");
      return reply.code(401).send(invalido);
    }

    limparTentativas(origem);
    const token = await criarSessao(usuario.id);

    return reply
      .setCookie(COOKIE, token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        // Em producao o CRM esta na internet, sempre atras de HTTPS.
        secure: cookieSeguro,
        maxAge: 30 * 86_400,
      })
      .send({ ok: true, usuario: { email: usuario.email, nome: usuario.name } });
  });

  app.post("/api/sair", async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await encerrarSessao(token);
    return reply.clearCookie(COOKIE, { path: "/", secure: cookieSeguro }).send({ ok: true });
  });

  /** Perfil: nome e aparencia. O e-mail de acesso vem do .env e nao muda por aqui. */
  app.patch("/api/eu", { preHandler: exigirLogin }, async (req, reply) => {
    const corpo = z
      .object({
        nome: z.string().trim().min(1).max(80).optional(),
        tema: z.enum(["claro", "escuro", "sistema"]).optional(),
      })
      .safeParse(req.body);
    if (!corpo.success) return reply.code(400).send({ erro: "Confira o nome e a aparência." });

    await db.user.update({
      where: { id: req.usuarioId! },
      data: { name: corpo.data.nome, theme: corpo.data.tema },
    });
    return { ok: true };
  });

  app.post("/api/eu/senha", { preHandler: exigirLogin }, async (req, reply) => {
    const corpo = z
      .object({ atual: z.string().min(1), nova: z.string().min(8).max(200) })
      .safeParse(req.body);
    if (!corpo.success) {
      return reply.code(400).send({ erro: "A nova senha precisa ter pelo menos 8 caracteres." });
    }

    const usuario = await db.user.findUnique({ where: { id: req.usuarioId! } });
    if (!usuario || !(await conferirSenha(corpo.data.atual, usuario.passwordHash))) {
      return reply.code(400).send({ erro: "A senha atual não confere. Digite de novo." });
    }

    await db.user.update({
      where: { id: usuario.id },
      data: { passwordHash: await gerarHash(corpo.data.nova) },
    });
    // Quem estava logado em outro aparelho com a senha antiga precisa entrar de novo.
    await db.session.deleteMany({
      where: { userId: usuario.id, id: { not: req.cookies[COOKIE] ?? "" } },
    });
    return { ok: true };
  });

  app.get("/api/eu", { preHandler: exigirLogin }, async (req) => {
    const usuario = await db.user.findUnique({ where: { id: req.usuarioId! } });
    const { negocio } = getNegocio();
    return {
      usuario: { email: usuario?.email, nome: usuario?.name, tema: usuario?.theme ?? "sistema" },
      negocio: {
        nome: negocio.negocio.nome,
        atendente: negocio.atendente.nome,
        agendaAtiva: negocio.agenda.ativo,
        // O formulario de agendamento manual do CRM oferece os mesmos servicos
        // que a IA conhece — um so lugar define isso, o negocio.json.
        servicos: negocio.servicos.map((s) => ({ nome: s.nome, duracaoMin: s.duracaoMin })),
        // Mesmo vocabulario de etiquetas que a IA recebe, para o CRM oferecer
        // escolha em vez de campo livre.
        etiquetas: negocio.etiquetas.map((e) => e.nome),
        // Rotulo de cada campo que a IA coleta, como a entrevista escreveu. Sem isso a
        // gaveta do lead mostrava a chave do banco ("procedimento_interesse").
        rotulosDeCampos: Object.fromEntries(negocio.camposExtras.map((c) => [c.chave, c.rotulo])),
        // A grade da agenda desenha o horario de funcionamento; fora dele, cinza.
        horarios: negocio.horarios.atendimento,
      },
    };
  });

  // -------------------------------------------------------------------------
  // Conexao do WhatsApp
  // -------------------------------------------------------------------------

  app.get("/api/whatsapp/status", { preHandler: exigirLogin }, async () => {
    try {
      const estado = estadoConexao();
      const conta = estado === "open" ? await contaConectada() : null;

      // Sinais de vida: "conectado" so diz que a sessao existe. Mensagem chegando e
      // IA respondendo e o que prova que o atendimento esta funcionando.
      const inicioDoDia = new Date();
      inicioDoDia.setHours(0, 0, 0, 0);
      const [recebidasHoje, respondidasHoje, ultima] = conta
        ? await Promise.all([
            db.message.count({ where: { direction: "IN", createdAt: { gte: inicioDoDia } } }),
            db.message.count({
              where: { direction: "OUT", author: "BOT", createdAt: { gte: inicioDoDia } },
            }),
            db.message.findFirst({
              where: { direction: "IN" },
              orderBy: { createdAt: "desc" },
              select: { createdAt: true },
            }),
          ])
        : [0, 0, null];

      return {
        estado,
        conectado: estado === "open",
        conta: conta
          ? {
              telefone: conta.telefone,
              telefoneFormatado: formatarTelefone(conta.telefone),
              nome: conta.nome,
              foto: conta.foto,
              desde: conta.desde,
            }
          : null,
        atividade: conta
          ? { recebidasHoje, respondidasHoje, ultimaRecebidaEm: ultima?.createdAt ?? null }
          : null,
        // O motivo da parada manda: "desconectado" nao ajuda ninguem quando a causa
        // e outro aparelho tendo assumido a conexao. Quem le precisa saber o que fazer.
        descricao:
          estado === "open"
            ? "WhatsApp conectado."
            : (motivoDaParada() ??
              (estado === "connecting"
                ? "Conectando... leia o QR Code com o celular."
                : "WhatsApp desconectado. Gere o QR Code para conectar.")),
      };
    } catch (e) {
      logger.error({ err: e }, "falha ao consultar estado do WhatsApp");
      return {
        estado: "desconhecido",
        conectado: false,
        // Texto de tela: sem nome de comando nem de arquivo. Quem comprou pede ao
        // Claude Code para resolver; o detalhe tecnico vai para o log, acima.
        descricao: "Não consegui falar com o WhatsApp. Feche o sistema e abra de novo.",
      };
    }
  });

  /** Desconecta e apaga a sessao: serve para trocar o numero do atendimento. */
  app.post("/api/whatsapp/desconectar", { preHandler: exigirLogin }, async () => {
    await desconectar();
    return { ok: true };
  });

  app.post("/api/whatsapp/conectar", { preHandler: exigirLogin }, async (_req, reply) => {
    try {
      await conectar();
      const qr = await obterQrCode();
      return {
        qrcode: qr.base64 ?? null,
        instrucao:
          "No celular: WhatsApp > Configuracoes > Dispositivos conectados > Conectar dispositivo. " +
          "Aponte a camera para o codigo.",
      };
    } catch (e) {
      logger.error({ err: e }, "falha ao gerar QR Code");
      return reply.code(502).send({
        erro: "O QR Code não foi gerado. Feche o sistema, abra de novo e tente outra vez.",
      });
    }
  });

  // -------------------------------------------------------------------------
  // Consumo da IA — responde "quanto isso esta me custando?"
  // -------------------------------------------------------------------------

  app.get("/api/uso", { preHandler: exigirLogin }, async () => {
    const registro = await db.setting.findUnique({ where: { key: "uso_llm" } });
    const uso = (registro?.value as Record<string, number> | undefined) ?? {};
    return {
      modelo: env.LLM_MODEL,
      chamadas: uso.chamadas ?? 0,
      tokensEntrada: uso.entrada ?? 0,
      tokensSaida: uso.saida ?? 0,
      tokensCacheLido: uso.cacheLido ?? 0,
      tokensCacheEscrito: uso.cacheEscrito ?? 0,
    };
  });
}

export { exigirLogin };
