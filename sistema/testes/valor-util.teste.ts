import "./preparar.js";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ehValorUtil } from "../src/agente/ferramentas.js";

/**
 * Do primeiro teste real (17/09/2026): a IA gravou nome = "não informado" e isso
 * apagou o nome que o WhatsApp ja dava. O card virou "não informado" no funil.
 *
 * Placeholder e pior que campo vazio: o vazio a gente sabe preencher depois; o
 * placeholder parece dado e ninguem corrige.
 */
describe("a IA nao pode gravar placeholder no lugar de dado", () => {
  it("aceita dado de verdade", () => {
    for (const bom of ["Ana", "Vitorio Augusto", "ana@email.com", "Clareamento dental"]) {
      assert.equal(ehValorUtil(bom), true, bom);
    }
  });

  it("recusa as formas de dizer que nao sabe", () => {
    for (const ruim of [
      "não informado",
      "nao informado",
      "NÃO INFORMADO",
      "  não sei  ",
      "desconhecido",
      "sem nome",
      "N/A",
      "-",
      "?",
      "null",
      "",
    ]) {
      assert.equal(ehValorUtil(ruim), false, ruim);
    }
  });

  it("recusa vazio e nulo", () => {
    assert.equal(ehValorUtil(undefined), false);
    assert.equal(ehValorUtil(null), false);
  });

  it("numero e sim/nao continuam valendo (campos de qualificacao)", () => {
    assert.equal(ehValorUtil(3), true);
    assert.equal(ehValorUtil(false), true);
  });
});
