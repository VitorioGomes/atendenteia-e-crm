import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { valorDaContagem } from "../web/src/animacao.js";

describe("contagem animada dos numeros do Painel", () => {
  test("quadro com horario anterior ao inicio nao conta para tras", () => {
    // O defeito real: o Painel mostrou "-3%" no lugar de 86%.
    assert.equal(valorDaContagem(0, 86, -5, 700), 0);
  });

  test("chega exatamente no alvo e nao passa dele", () => {
    assert.equal(valorDaContagem(0, 86, 700, 700), 86);
    assert.equal(valorDaContagem(0, 86, 5000, 700), 86);
  });

  test("no meio, fica entre o inicio e o alvo", () => {
    const meio = valorDaContagem(0, 86, 350, 700);
    assert.ok(meio > 0 && meio < 86);
  });

  test("contando para baixo tambem respeita os limites", () => {
    assert.equal(valorDaContagem(50, 10, -20, 700), 50);
    assert.equal(valorDaContagem(50, 10, 700, 700), 10);
  });
});
