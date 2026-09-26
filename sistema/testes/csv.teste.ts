import "./preparar.js";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deCsv, normalizarChave, paraCsv } from "../src/lib/csv.js";

describe("csv para planilha brasileira", () => {
  test("exporta com ponto e virgula e com BOM", () => {
    const csv = paraCsv(["telefone", "nome"], [["5511987654321", "Ana"]]);

    // Sem o BOM, o Excel mostra acento quebrado e o comprador acha que o
    // sistema esta com defeito.
    assert.equal(csv.charCodeAt(0), 0xfeff, "faltou o BOM no inicio do arquivo");
    assert.ok(csv.includes("telefone;nome"), "o separador precisa ser ponto e virgula");
  });

  test("acento sobrevive a ida e volta", () => {
    const csv = paraCsv(
      ["telefone", "nome", "observacao"],
      [["5511987654321", "João Gonçalves", "avaliação às 14h"]],
    );

    const lido = deCsv(csv);
    assert.equal(lido.length, 1);
    assert.equal(lido[0]?.nome, "João Gonçalves");
    assert.equal(lido[0]?.observacao, "avaliação às 14h");
  });

  test("escapa campo que contem o separador, aspas ou quebra de linha", () => {
    const csv = paraCsv(
      ["nome", "obs"],
      [["Silva; Souza", 'ela disse "ok"'], ["Duas", "linhas\nassim"]],
    );

    const lido = deCsv(csv);
    assert.equal(lido[0]?.nome, "Silva; Souza");
    assert.equal(lido[0]?.obs, 'ela disse "ok"');
    assert.equal(lido[1]?.obs, "linhas\nassim");
  });

  test("le arquivo separado por virgula tambem", () => {
    const lido = deCsv("telefone,nome\n11987654321,Ana Paula\n");
    assert.equal(lido.length, 1);
    assert.equal(lido[0]?.telefone, "11987654321");
    assert.equal(lido[0]?.nome, "Ana Paula");
  });

  test("cabecalho vira chave sem acento e sem maiuscula", () => {
    assert.equal(normalizarChave("Telefone"), "telefone");
    assert.equal(normalizarChave("E-mail"), "e_mail");
    assert.equal(normalizarChave(" Observação "), "observacao");
    assert.equal(normalizarChave("Nome Completo"), "nome_completo");
  });

  test("ignora linhas em branco no fim do arquivo", () => {
    // Planilha exportada quase sempre termina com linhas vazias.
    const lido = deCsv("telefone;nome\n5511999999999;Ana\n;\n\n");
    assert.equal(lido.length, 1);
  });

  test("arquivo vazio nao quebra", () => {
    assert.deepEqual(deCsv(""), []);
    assert.deepEqual(deCsv("   \n  "), []);
  });
});
