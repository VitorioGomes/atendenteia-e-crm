#!/usr/bin/env node
/**
 * Apaga as conversas, os contatos, o funil e a agenda para comecar um teste do zero.
 *
 *   npm run limpar -- --sim
 *
 * Existe porque testar o atendente com WhatsApp de verdade suja o banco: o lead do
 * teste anterior aparece no funil, a IA ja "conhece" a pessoa pelo historico e a
 * taxa do painel fica errada. Apagar o arquivo inteiro resolveria, mas derrubaria
 * junto o login, a senha trocada na tela, o funil configurado e as respostas
 * rapidas — coisas que nao fazem parte do teste.
 *
 * O que SAI: contato, conversa, mensagem, arquivo de midia, card do funil, historico
 * do card, agendamento, tarefa agendada (lembrete e follow-up) e o consumo da IA.
 * O que FICA: seu login e sua sessao aberta, os estagios do funil, os bloqueios da
 * agenda, as respostas rapidas e a conexao do WhatsApp.
 */

import { readdir, rm, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(AQUI);
process.env.DATABASE_URL ??= "file:../dados/crm.db";

const VERDE = "\x1b[32m";
const VERMELHO = "\x1b[31m";
const AMARELO = "\x1b[33m";
const NEGRITO = "\x1b[1m";
const FIM = "\x1b[0m";

const BANCO = path.join(AQUI, "dados", "crm.db");
const MIDIA = path.join(AQUI, "dados", "midia");

function morrer(problema, oQueFazer) {
  console.error(`\n${VERMELHO}  [erro]${FIM} ${problema}`);
  if (oQueFazer) console.error(`         ${NEGRITO}O que fazer:${FIM} ${oQueFazer}\n`);
  process.exit(1);
}

if (!process.argv.includes("--sim")) {
  console.log(`
${NEGRITO}Comecar um teste do zero${FIM}

Isto apaga ${NEGRITO}conversas, contatos, cards do funil e agendamentos${FIM}.
Continuam de pe: seu login, o funil configurado, as respostas rapidas e a
conexao do WhatsApp. Uma copia do banco e guardada antes de apagar.

Se for isso mesmo, rode:

  ${AMARELO}npm run limpar -- --sim${FIM}
`);
  process.exit(1);
}

if (!existsSync(BANCO)) {
  morrer("Nao achei o banco de dados.", "Rode npm run pc uma vez para criar o sistema.");
}

// Com o sistema ligado, o atendente pode gravar mensagem no meio da limpeza e
// ressuscitar meio contato. Melhor parar antes do que explicar depois.
try {
  const porta = process.env.PORT ?? "3000";
  const r = await fetch(`http://localhost:${porta}/saude`, { signal: AbortSignal.timeout(1500) });
  if (r.ok) {
    morrer(
      "O sistema esta ligado.",
      "Aperte Ctrl+C na janela onde ele esta rodando, limpe, e depois rode npm run pc de novo.",
    );
  }
} catch {
  /* fora do ar e exatamente o que queremos */
}

const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

// Fora de dados/ de proposito: aquela pasta e a que o backup copia e a que viaja
// para a VPS na mudanca. Copia de seguranca guardada la dentro entraria no pacote
// e seria restaurada junto, multiplicando lixo a cada limpeza.
const pastaCopias = path.join(AQUI, "backups");
await mkdir(pastaCopias, { recursive: true });
const copia = path.join(pastaCopias, `antes-de-limpar-${carimbo}.db`);
await copyFile(BANCO, copia);
console.log(`${VERDE}  [ok]${FIM} Copia guardada em backups/${path.basename(copia)}`);

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

// Ordem importa: filho antes de pai, senao a chave estrangeira recusa.
const contas = {};
for (const [nome, tabela] of [
  ["Mensagens", db.message],
  ["Tarefas agendadas", db.job],
  ["Agendamentos", db.appointment],
  ["Historico do funil", db.dealEvent],
  ["Cards do funil", db.deal],
  ["Conversas", db.conversation],
  ["Contatos", db.contact],
]) {
  const { count } = await tabela.deleteMany({});
  contas[nome] = count;
}

// O consumo da IA e do teste anterior: comecar do zero inclui o numero do painel.
await db.setting.deleteMany({ where: { key: "uso_llm" } });
await db.$disconnect();

// Arquivo de midia sem mensagem e lixo em disco que ninguem mais consegue abrir.
let arquivos = 0;
if (existsSync(MIDIA)) {
  for (const nome of await readdir(MIDIA)) {
    await rm(path.join(MIDIA, nome), { force: true });
    arquivos += 1;
  }
}

console.log(`\n${NEGRITO}Apagado:${FIM}`);
for (const [nome, quantos] of Object.entries(contas)) {
  console.log(`  ${String(quantos).padStart(5)}  ${nome}`);
}
console.log(`  ${String(arquivos).padStart(5)}  Arquivos recebidos (fotos, audios)`);
console.log(`\n${VERDE}  [ok]${FIM} Pronto. Rode ${AMARELO}npm run pc${FIM} e mande a primeira mensagem.\n`);
