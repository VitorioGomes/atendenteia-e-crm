import "./preparar.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { NegocioSchema } from "../src/config/negocio.js";
import { montarSystem } from "../src/agente/prompt.js";
import { definirFerramentas } from "../src/agente/ferramentas.js";

/**
 * O exemplo da barbearia e o que a skill mostra para quem nao e da saude (revisao geral
 * de 26/09/2026: nenhum teste o lia). Se ele ficar invalido, a IA de terminal copia um
 * arquivo que o sistema recusa, na maquina do comprador.
 */

const aqui = path.dirname(fileURLToPath(import.meta.url));

async function barbearia() {
  const json = JSON.parse(
    await readFile(path.resolve(aqui, "..", "..", "skill", "exemplos", "barbearia.json"), "utf8"),
  );
  return { negocio: NegocioSchema.parse(json), conhecimento: "" };
}

describe("exemplo da barbearia", () => {
  test("passa no schema do sistema", async () => {
    const config = await barbearia();
    assert.ok(config.negocio.servicos.length > 0);
  });

  test("o atendente e masculino e se apresenta como tal", async () => {
    const config = await barbearia();
    const texto = montarSystem(config, {
      nome: null,
      telefone: "5511987654321",
      estagioAtual: config.negocio.funil.estagios[0]!.chave,
      estagioNome: config.negocio.funil.estagios[0]!.nome,
      resumo: null,
      camposConhecidos: {},
      tags: [],
      primeiraConversa: true,
    })
      .map((b) => b.text)
      .join("\n");
    assert.match(texto, /um assistente virtual/);
    assert.doesNotMatch(texto, /uma assistente virtual/);
  });

  test("sem servico marcado como agendavel, a IA marca qualquer um", async () => {
    const config = await barbearia();
    const agendar = definirFerramentas(config).find((f) => f.name === "agendar");
    const opcoes = (agendar?.input_schema.properties as any)?.servico?.enum;
    assert.deepEqual(opcoes, config.negocio.servicos.map((s) => s.nome));
  });
});
