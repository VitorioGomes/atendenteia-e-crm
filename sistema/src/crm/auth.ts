import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { env } from "../config/env.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";

const scryptAsync = promisify(scrypt) as (
  senha: string,
  sal: string,
  tamanho: number,
) => Promise<Buffer>;

const DURACAO_SESSAO_DIAS = 30;

export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16).toString("hex");
  const derivada = await scryptAsync(senha, sal, 64);
  return `${sal}:${derivada.toString("hex")}`;
}

export async function conferirSenha(senha: string, hash: string): Promise<boolean> {
  const [sal, esperado] = hash.split(":");
  if (!sal || !esperado) return false;
  const derivada = await scryptAsync(senha, sal, 64);
  const bufferEsperado = Buffer.from(esperado, "hex");
  if (bufferEsperado.length !== derivada.length) return false;
  return timingSafeEqual(bufferEsperado, derivada);
}

/**
 * Cria (ou atualiza a senha do) usuario do CRM a partir do .env.
 *
 * Deliberadamente assim: o comprador nao tem tela de cadastro nem e-mail de confirmacao.
 * Ele escreve e-mail e senha no .env e entra. Um passo a menos na instalacao.
 */
/**
 * O .env manda na senha so quando ELE muda. Antes a senha do .env era reaplicada a
 * cada inicio, entao a senha trocada pela tela de Perfil voltava sozinha no dia
 * seguinte. Agora guardamos a impressao digital da senha do .env que ja foi aplicada:
 * se o dono editar o .env (esqueceu a senha, por exemplo), ela vale de novo.
 */
const MARCA_SENHA_ENV = "senha_env_aplicada";

function impressaoDaSenha(senha: string): string {
  return createHash("sha256").update(`atendente-crm:${senha}`).digest("hex");
}

export async function garantirUsuario(): Promise<void> {
  const email = env.CRM_EMAIL.toLowerCase().trim();
  const impressao = impressaoDaSenha(env.CRM_PASSWORD);
  const marca = await db.setting.findUnique({ where: { key: MARCA_SENHA_ENV } });
  const aplicada = (marca?.value as { impressao?: string } | null)?.impressao;

  const existente = await db.user.findUnique({ where: { email } });

  if (!existente) {
    await db.user.create({
      data: { email, passwordHash: await gerarHash(env.CRM_PASSWORD), name: "Dono" },
    });
    logger.info({ email }, "usuario do CRM criado");
  } else if (aplicada !== impressao) {
    // Senha do .env nova (ou primeiro inicio com esta regra): vale a do .env.
    if (!(await conferirSenha(env.CRM_PASSWORD, existente.passwordHash))) {
      await db.user.update({
        where: { id: existente.id },
        data: { passwordHash: await gerarHash(env.CRM_PASSWORD) },
      });
      await db.session.deleteMany({ where: { userId: existente.id } });
      logger.info({ email }, "senha do CRM atualizada a partir do .env");
    }
  }

  await db.setting.upsert({
    where: { key: MARCA_SENHA_ENV },
    create: { key: MARCA_SENHA_ENV, value: { impressao } },
    update: { value: { impressao } },
  });
}

export async function criarSessao(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      id: token,
      userId,
      expiresAt: new Date(Date.now() + DURACAO_SESSAO_DIAS * 86_400_000),
    },
  });
  return token;
}

export async function validarSessao(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const sessao = await db.session.findUnique({ where: { id: token } });
  if (!sessao) return null;
  if (sessao.expiresAt < new Date()) {
    await db.session.delete({ where: { id: token } }).catch(() => {});
    return null;
  }
  return sessao.userId;
}

export async function encerrarSessao(token: string): Promise<void> {
  await db.session.delete({ where: { id: token } }).catch(() => {});
}
