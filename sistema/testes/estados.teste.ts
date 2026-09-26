import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { lerEtiquetas, paraCentavos, paraReais } from "../src/lib/estados.js";

/**
 * Estes testes existem por causa da troca de Postgres para SQLite (16/09/2026).
 *
 * O SQLite nao tem lista de String nem Decimal. As etiquetas passaram a ser Json e o
 * dinheiro passou a ser um inteiro em centavos — duas mudancas silenciosas, do tipo que
 * so aparece em producao. Sao os dois pontos onde a migracao pode estragar dado.
 */

describe("etiquetas vindas do Json do SQLite", () => {
  it("le um array normal", () => {
    assert.deepEqual(lerEtiquetas(["particular", "convênio"]), ["particular", "convênio"]);
  });

  it("contato antigo sem etiqueta vira lista vazia, nao quebra o atendimento", () => {
    assert.deepEqual(lerEtiquetas(null), []);
    assert.deepEqual(lerEtiquetas(undefined), []);
  });

  it("ignora Json que nao e lista", () => {
    assert.deepEqual(lerEtiquetas("particular"), []);
    assert.deepEqual(lerEtiquetas({ 0: "particular" }), []);
    assert.deepEqual(lerEtiquetas(42), []);
  });

  it("descarta item que nao e texto util, mantendo o resto", () => {
    assert.deepEqual(lerEtiquetas(["particular", null, 7, "", { a: 1 }, "urgente"]), [
      "particular",
      "urgente",
    ]);
  });
});

describe("dinheiro em centavos", () => {
  it("ida e volta nao perde centavo", () => {
    for (const reais of [0, 0.01, 1.99, 1800.55, 12345.67, 99999.99]) {
      assert.equal(paraReais(paraCentavos(reais)), reais, `falhou em ${reais}`);
    }
  });

  it("arredonda o erro do ponto flutuante em vez de truncar", () => {
    // 19.99 * 100 da 1998.9999999999998 em ponto flutuante. Truncar viraria R$ 19,98.
    assert.equal(paraCentavos(19.99), 1999);
    assert.equal(paraCentavos(8.07), 807);
  });

  it("vazio continua vazio", () => {
    assert.equal(paraCentavos(null), null);
    assert.equal(paraCentavos(undefined), null);
    assert.equal(paraReais(null), null);
  });

  it("numero invalido nao vira NaN no banco", () => {
    assert.equal(paraCentavos(Number.NaN), null);
    assert.equal(paraCentavos(Number.POSITIVE_INFINITY), null);
  });
});
