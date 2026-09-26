#!/usr/bin/env node
/**
 * Leva o sistema do computador para a VPS, sem refazer nada.
 *
 *   npm run mudar
 *
 * O caminho do curso e testar no PC primeiro e so depois comprar a VPS. Sem este
 * comando, subir para a VPS significaria responder a entrevista da skill de novo
 * (gerando um negocio.json diferente do que o banco ja usa), perder os leads do
 * teste e ler um QR Code novo. Nada disso e aceitavel.
 *
 * Tres coisas sao insubstituiveis e viajam juntas:
 *   negocio/  as respostas da entrevista (o funil do banco aponta para elas)
 *   dados/    o banco do CRM, os arquivos das conversas e a sessao do WhatsApp
 *   .env      a chave da IA e o login do CRM
 *
 * O pacote sai no mesmo formato do backup.sh, entao quem restaura na VPS e o
 * restaurar.sh que ja existe. Um formato, dois usos.
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
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

function morrer(problema, oQueFazer) {
  console.error(`\n${VERMELHO}  [erro]${FIM} ${problema}`);
  if (oQueFazer) console.error(`         ${NEGRITO}O que fazer:${FIM} ${oQueFazer}\n`);
  process.exit(1);
}

// O banco e a sessao do WhatsApp nao podem ser copiados com o sistema escrevendo
// neles: sai pela metade e so se descobre na VPS, com o atendimento parado.
try {
  const porta = process.env.PORT ?? "3000";
  const r = await fetch(`http://localhost:${porta}/saude`, { signal: AbortSignal.timeout(1500) });
  if (r.ok) {
    morrer(
      "O sistema esta ligado.",
      "Aperte Ctrl+C na janela onde ele esta rodando e rode este comando de novo.",
    );
  }
} catch {
  /* desligado e o que queremos */
}

for (const [caminho, oQueFazer] of [
  ["dados/crm.db", "Rode npm run pc uma vez e converse com o atendente antes de mudar."],
  [".env", "Rode npm run pc uma vez: e ele que cria este arquivo."],
  ["negocio/negocio.json", "Rode npm run pc uma vez para criar a configuracao do negocio."],
]) {
  if (!existsSync(path.join(AQUI, caminho))) morrer(`Nao achei ${caminho}.`, oQueFazer);
}

titulo("Empacotando o que nao pode ser refeito");

const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const nome = `mudanca-${carimbo}.tar.gz`;

// O tar vem com o Windows 10 e com o Mac. A ordem dos itens define o formato que
// o restaurar.sh espera na VPS: dados/, .env e negocio/ na raiz do pacote.
//
// Nenhum caminho absoluto entra aqui de proposito. O tar do GNU le "D:/pasta" como
// se "D" fosse um servidor remoto e tenta conectar nele ("Cannot connect to D"), o
// que quebraria a mudanca em todo Windows que tem o Git instalado. Como o processo
// ja roda dentro de sistema/, caminho relativo resolve e nao tem armadilha.
const feito = spawnSync(
  "tar",
  // Copias antigas do "npm run limpar" ficavam dentro de dados/ e nao tem por que
  // viajar: o que importa e o banco de agora.
  ["-czf", nome, "--exclude", "antes-de-limpar-*.db", "dados", ".env", "negocio"],
  {
    cwd: AQUI,
    stdio: "inherit",
  },
);

if (feito.error || feito.status !== 0) {
  morrer(
    "Nao consegui criar o pacote da mudanca.",
    "Confira se o comando tar existe: abra o terminal e digite tar --version.",
  );
}

const tamanho = statSync(path.join(AQUI, nome)).size;
if (tamanho < 2048) {
  morrer(`O pacote saiu vazio (${tamanho} bytes).`, "Rode o comando de novo com o sistema desligado.");
}

const megas = (tamanho / 1024 / 1024).toFixed(1);
ok(`Pacote criado: ${nome} (${megas} MB)`);

// Ligar o PC de novo depois da mudanca faz os dois brigarem pela mesma sessao do
// WhatsApp, e quem cai e a VPS. O pc.mjs le este arquivo e avisa antes de ligar.
await writeFile(
  path.join(AQUI, "mudou-para-vps.txt"),
  `Este sistema foi empacotado para a VPS em ${new Date().toLocaleString("pt-BR")}.\n` +
    `Pacote: ${nome}\n\n` +
    "Depois que a VPS estiver no ar, nao ligue o sistema aqui de novo:\n" +
    "os dois brigariam pela mesma conexao do WhatsApp e a VPS sairia do ar.\n" +
    "Se voce desistiu da mudanca, apague este arquivo.\n",
  "utf8",
);

console.log(`
${NEGRITO}Agora, na VPS${FIM}

  1. Mande o pacote para la, do seu computador:
     ${AMARELO}scp "${path.join(AQUI, nome)}" root@SEU_IP:/root/${FIM}

  2. Entre na VPS e instale o sistema JA COM o pacote:
     ${AMARELO}ssh root@SEU_IP${FIM}
     ${AMARELO}bash instalar.sh /root/${nome}${FIM}

     O instalador coloca tudo no lugar antes de subir o sistema, e so vai te
     perguntar o endereco do CRM na internet, que e a unica coisa que nao existe
     no computador. Se a VPS ja estiver instalada, use no lugar disso:
     ${AMARELO}bash restaurar.sh /root/${nome}${FIM}

${NEGRITO}Depois disso${FIM}

  O CRM, os contatos, as conversas e o WhatsApp conectado continuam como estavam.
  ${VERMELHO}Nao ligue o sistema neste computador de novo${FIM}: os dois brigariam pela mesma
  conexao do WhatsApp e quem sairia do ar e a VPS.

  ${AMARELO}O pacote tem a sua chave da IA e a sua senha do CRM dentro.${FIM} Trate como senha:
  apague depois de restaurar, e nao mande por e-mail nem por WhatsApp.
`);
