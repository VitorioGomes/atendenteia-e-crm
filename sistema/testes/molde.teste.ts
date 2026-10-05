import "./preparar.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { NegocioSchema } from "../src/config/negocio.js";
import { definirFerramentas } from "../src/agente/ferramentas.js";
import { negocioExemplo } from "./fixtures.js";

/**
 * O molde vazio e o ponto de partida da skill (05/10/2026). Antes ela copiava uma clinica
 * preenchida, e as regras genericas da clinica viravam configuracao do comprador: ficavam
 * congeladas no negocio.json dele, o git pull nao as atualizava, e elas brigavam com o
 * comportamento novo do sistema.
 */

const aqui = path.dirname(fileURLToPath(import.meta.url));

async function molde() {
  return JSON.parse(await readFile(path.resolve(aqui, "..", "negocio", "negocio.molde.json"), "utf8"));
}

describe("molde vazio do negocio.json", () => {
  test("tem todas as secoes do schema", async () => {
    const m = await molde();
    for (const secao of Object.keys(NegocioSchema.shape)) assert.ok(secao in m, `falta ${secao}`);
  });

  test("nao traz regra nem conteudo de negocio nenhum", async () => {
    const m = await molde();
    assert.deepEqual(m.atendente.regras, []);
    assert.deepEqual(m.atendente.naoFaz, []);
    assert.deepEqual(m.handoff.gatilhos, []);
    assert.deepEqual(m.servicos, []);
    assert.deepEqual(m.funil.estagios, []);
    assert.equal(m.negocio.nome, "");
  });

  test("preenchido com o obrigatorio, o sistema aceita", async () => {
    const m = await molde();
    m.negocio.nome = "Negocio de teste";
    m.atendente.nome = "Ana";
    m.objetivo.principal = "marcar uma visita";
    m.funil.estagios = [
      { chave: "novo", nome: "Novo" },
      { chave: "ganho", nome: "Fechou", ganho: true },
    ];
    assert.ok(NegocioSchema.parse(m));
  });
});

describe("servicos agendaveis", () => {
  test("sem servico marcado como agendavel, a IA marca qualquer um", async () => {
    const config = await negocioExemplo();
    config.negocio.servicos = config.negocio.servicos.map((s) => ({ ...s, agendavel: false }));
    const agendar = definirFerramentas(config).find((f) => f.name === "agendar");
    const opcoes = (agendar?.input_schema.properties as any)?.servico?.enum;
    assert.deepEqual(opcoes, config.negocio.servicos.map((s) => s.nome));
  });
});
