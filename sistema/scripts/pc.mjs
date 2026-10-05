#!/usr/bin/env node
/**
 * Liga o sistema no computador do comprador. Sem Docker, sem banco para instalar,
 * sem WSL — so o Node, que a IA de terminal ja exigiu para existir.
 *
 *   npm run pc
 *
 * Pode rodar quantas vezes quiser: nao refaz o que ja esta pronto.
 *
 * Regra deste arquivo: toda mensagem em portugues, e toda falha diz o que fazer.
 * Quem le isso pode nunca ter aberto um terminal na vida.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(AQUI);

const VERDE = "\x1b[32m";
const VERMELHO = "\x1b[31m";
const AMARELO = "\x1b[33m";
const NEGRITO = "\x1b[1m";
const FIM = "\x1b[0m";

const titulo = (t) => console.log(`\n${NEGRITO}==> ${t}${FIM}`);
const ok = (t) => console.log(`${VERDE}  [ok]${FIM} ${t}`);
const aviso = (t) => console.log(`${AMARELO}  [atencao]${FIM} ${t}`);

function morrer(problema, oQueFazer) {
  console.error(`\n${VERMELHO}  [erro]${FIM} ${problema}`);
  if (oQueFazer) console.error(`         ${NEGRITO}O que fazer:${FIM} ${oQueFazer}\n`);
  process.exit(1);
}

/**
 * O Prisma CLI le o .env por conta propria e nao conhece o padrao que o sistema usa
 * no codigo. Sem isto, "migrate deploy" falha dizendo que DATABASE_URL nao existe.
 */
const BANCO = { DATABASE_URL: process.env.DATABASE_URL ?? "file:../dados/crm.db" };

/** Preenchido depois de ler o .env; vai junto para todo processo filho. */
let configuracao = {};

/**
 * Roda um comando.
 *
 * No Windows, "npm" e "npx" sao arquivos .cmd, e o Node novo se recusa a executar
 * .cmd sem shell (spawn EINVAL) — foi uma correcao de seguranca. Com shell ligado,
 * passar argumentos em lista tambem e desaconselhado, porque eles sao concatenados
 * sem escape. Entao no Windows o comando ja vai montado e com aspas, e os argumentos
 * sao nossos, nunca do usuario.
 */
function rodar(comando, argumentos, { silencioso = false } = {}) {
  const noWindows = process.platform === "win32";
  const linha = [comando, ...argumentos.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(" ");

  return new Promise((resolve, reject) => {
    const filho = noWindows
      ? spawn(linha, {
          shell: true,
          stdio: silencioso ? ["ignore", "pipe", "pipe"] : "inherit",
          env: { ...process.env, ...configuracao, ...BANCO },
        })
      : spawn(comando, argumentos, {
          stdio: silencioso ? ["ignore", "pipe", "pipe"] : "inherit",
          env: { ...process.env, ...configuracao, ...BANCO },
        });

    // Quando a saida e escondida, ela e guardada: se falhar, o motivo aparece.
    let saida = "";
    filho.stdout?.on("data", (d) => (saida += d));
    filho.stderr?.on("data", (d) => (saida += d));

    filho.on("error", reject);
    filho.on("close", (codigo) => {
      if (codigo === 0) return resolve();
      const detalhe = saida.trim().split("\n").slice(-6).join("\n         ");
      reject(
        new Error(
          `${comando} terminou com codigo ${codigo}` + (detalhe ? `\n         ${detalhe}` : ""),
        ),
      );
    });
  });
}

// ---------------------------------------------------------------------------
// 0. Este sistema ja mudou para a VPS?
//
// Depois da mudanca, ligar aqui de novo faz os dois brigarem pela mesma conexao
// do WhatsApp, e quem sai do ar e a VPS: o atendimento de verdade para e ninguem
// entende por que. Por isso e recusa, nao aviso.
// ---------------------------------------------------------------------------
const MARCA_MUDANCA = path.join(AQUI, "mudou-para-vps.txt");

if (existsSync(MARCA_MUDANCA) && !process.argv.includes("--mesmo-assim")) {
  console.log(`
${AMARELO}  [atencao]${FIM} ${await readFile(MARCA_MUDANCA, "utf8")}`);
  morrer(
    "Este sistema foi movido para a VPS.",
    "Se a VPS ja esta no ar, use o CRM por la. Se a mudanca nao deu certo e voce " +
      "quer ligar aqui mesmo assim, rode: npm run pc -- --mesmo-assim",
  );
}

// ---------------------------------------------------------------------------
// 1. Node novo o bastante
// ---------------------------------------------------------------------------
titulo("Conferindo o computador");

const maior = Number(process.versions.node.split(".")[0]);
if (maior < 20) {
  morrer(
    `Este computador tem o Node ${process.versions.node}, e o sistema precisa do 20 ou mais novo.`,
    "Instale a versao LTS em https://nodejs.org , feche o terminal, abra de novo e rode novamente.",
  );
}
ok(`Node ${process.versions.node}`);

// Quem acabou de baixar o sistema so tem os arquivos: as bibliotecas ainda nao
// existem. Isso leva alguns minutos, e so na primeira vez.
if (!existsSync(path.join(AQUI, "node_modules"))) {
  console.log("  Baixando as bibliotecas do sistema. Leva alguns minutos, so agora.");
  try {
    await rodar("npm", ["install"], { silencioso: true });
    ok("Bibliotecas instaladas");
  } catch (e) {
    morrer(
      `Nao consegui baixar as bibliotecas: ${e.message}`,
      "Confira se este computador esta conectado a internet e rode 'npm install' nesta pasta.",
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Configuracao do negocio
// ---------------------------------------------------------------------------
titulo("Configuracao do negocio");

// Ate 05/10/2026 copiava uma clinica ficticia quando faltava a configuracao, e o sistema
// subia atendendo como dentista. Sem a entrevista nao ha negocio para atender.
if (existsSync(path.join(AQUI, "negocio", "negocio.json"))) {
  ok("negocio.json ja existe");
} else {
  morrer(
    "Falta a configuracao do negocio (negocio/negocio.json).",
    "Peca para a IA instalar seguindo o roteiro skill/INSTALAR.md: ela faz a entrevista e escreve esse arquivo.",
  );
}
if (!existsSync(path.join(AQUI, "negocio", "conhecimento.md"))) {
  aviso("Nao ha negocio/conhecimento.md. O atendente vai saber so o basico.");
}

// ---------------------------------------------------------------------------
// 3. Arquivo .env
// ---------------------------------------------------------------------------
titulo("Configuracao do sistema");

const caminhoEnv = path.join(AQUI, ".env");
let faltando = [];

if (!existsSync(caminhoEnv)) {
  // No PC o CRM e local: nada de dominio, nada de certificado, senha simples serve
  // porque so quem esta na maquina alcanca.
  const conteudo = [
    "# Criado por 'npm run pc'. Este arquivo tem senhas: nao mande para ninguem.",
    "",
    "# Chave da IA que responde os leads.",
    "# Anthropic: https://console.anthropic.com -> API Keys",
    "ANTHROPIC_API_KEY=",
    "",
    "# Entrar no CRM (http://localhost:3000). O e-mail nao precisa ser de verdade,",
    "# e so o seu usuario — mas precisa ter o formato de e-mail.",
    "CRM_EMAIL=dono@negocio.com",
    "CRM_PASSWORD=mudar-esta-senha",
    "",
    `SESSION_SECRET=${randomBytes(24).toString("hex")}`,
    "TIMEZONE=America/Sao_Paulo",
    "",
    "# Entender audio dos leads (opcional). https://platform.openai.com/api-keys",
    "OPENAI_API_KEY=",
    "",
  ].join("\n");
  await writeFile(caminhoEnv, conteudo, "utf8");
  aviso("Arquivo .env criado");
}

/**
 * Le o .env para dentro de um objeto.
 *
 * No Docker quem entregava essas variaveis ao sistema era o compose. No computador
 * do comprador nao ha ninguem: e este script que le o arquivo e repassa.
 */
const lerEnv = async () => {
  const texto = await readFile(caminhoEnv, "utf8");
  const mapa = {};
  for (const linha of texto.split(/\r?\n/)) {
    const corte = linha.indexOf("=");
    if (corte < 1 || linha.trimStart().startsWith("#")) continue;
    mapa[linha.slice(0, corte).trim()] = linha
      .slice(corte + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return mapa;
};

configuracao = await lerEnv();
const valor = (chave) => configuracao[chave] ?? "";

if (!valor("ANTHROPIC_API_KEY")) faltando.push("ANTHROPIC_API_KEY");
if (!valor("CRM_PASSWORD") || valor("CRM_PASSWORD") === "mudar-esta-senha") {
  faltando.push("CRM_PASSWORD");
}

if (faltando.length > 0) {
  console.log();
  console.log(`${NEGRITO}  Falta preencher ${faltando.length === 1 ? "1 campo" : `${faltando.length} campos`} no arquivo:${FIM}`);
  console.log(`  ${caminhoEnv}`);
  console.log();
  for (const campo of faltando) {
    if (campo === "ANTHROPIC_API_KEY") {
      console.log("  - ANTHROPIC_API_KEY  a chave da IA, que comeca com sk-ant-");
      console.log("                       crie em https://console.anthropic.com (menu API Keys)");
    }
    if (campo === "CRM_PASSWORD") {
      console.log("  - CRM_PASSWORD       a senha que voce vai usar para entrar no CRM");
    }
  }
  console.log();
  console.log("  Preencha, salve o arquivo e rode de novo:  npm run pc");
  console.log();
  process.exit(1);
}
ok("Arquivo .env preenchido");

// ---------------------------------------------------------------------------
// 4. Banco (um arquivo) e front
// ---------------------------------------------------------------------------
titulo("Preparando o banco");

await mkdir(path.join(AQUI, "dados"), { recursive: true });
try {
  await rodar("npx", ["prisma", "migrate", "deploy"], { silencioso: true });
  await rodar("npx", ["prisma", "generate"], { silencioso: true });
  ok("Banco pronto em dados/crm.db");
} catch (e) {
  morrer(
    `Nao consegui preparar o banco: ${e.message}`,
    "Rode 'npx prisma migrate deploy' nesta pasta e leia o erro completo.",
  );
}

if (!existsSync(path.join(AQUI, "web", "dist", "index.html"))) {
  titulo("Montando a tela do CRM");
  console.log("  Isso leva 1 ou 2 minutos, so na primeira vez.");
  try {
    if (!existsSync(path.join(AQUI, "web", "node_modules"))) {
      await rodar("npm", ["install", "--prefix", "web"], { silencioso: true });
    }
    await rodar("npm", ["run", "build", "--prefix", "web"], { silencioso: true });
    ok("Tela do CRM pronta");
  } catch (e) {
    morrer(
      `Nao consegui montar a tela do CRM: ${e.message}`,
      "Rode 'npm install && npm run build' dentro da pasta web e leia o erro.",
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Liga
// ---------------------------------------------------------------------------
titulo("Ligando o atendente");

console.log();
console.log(`  ${NEGRITO}CRM:${FIM} http://localhost:3000`);
console.log(`  ${NEGRITO}Entrar com:${FIM} ${valor("CRM_EMAIL")}`);
console.log();
console.log("  Para conectar o WhatsApp, abra o CRM e va em Conexao.");
console.log(`  ${AMARELO}Enquanto esta janela estiver aberta, o atendente responde.${FIM}`);
console.log("  Fechar a janela (ou desligar o computador) para o atendimento.");
console.log();

try {
  await rodar("npx", ["tsx", "src/server.ts"]);
} catch (e) {
  morrer(
    `O atendente parou: ${e.message}`,
    "Leia as linhas acima: elas dizem o que faltou. Depois rode de novo: npm run pc",
  );
}
