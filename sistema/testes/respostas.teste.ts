import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { normalizarAtalho } from "../src/lib/atalho.js";
import { atalhoDigitado, preencherResposta, primeiroNome } from "../web/src/respostas.js";

describe("respostas rapidas", () => {
  it("atalho sem acento, sem espaco, sem barra", () => {
    assert.equal(normalizarAtalho("/Preço Clareamento"), "preco-clareamento");
    assert.equal(normalizarAtalho("  endereço  "), "endereco");
    assert.equal(normalizarAtalho("pix_ou_cartao!"), "pix-ou-cartao");
    assert.equal(normalizarAtalho("///"), "");
  });

  it("{nome} vira o primeiro nome, arrumado", () => {
    assert.equal(primeiroNome("ana PAULA ribeiro"), "Ana");
    assert.equal(preencherResposta("Oi {nome}, tudo bem?", "carlos mendes"), "Oi Carlos, tudo bem?");
  });

  it("sem nome conhecido, o {nome} some sem deixar buraco", () => {
    assert.equal(preencherResposta("Oi {nome}, tudo bem?", null), "Oi, tudo bem?");
    assert.equal(preencherResposta("{nome}, a avaliacao e gratuita.", null), "A avaliacao e gratuita.");
    assert.equal(preencherResposta("Obrigada, {nome}!", ""), "Obrigada!");
  });

  it("so abre a lista enquanto e um atalho, nao uma frase", () => {
    assert.equal(atalhoDigitado("/end"), "end");
    assert.equal(atalhoDigitado("/"), "");
    assert.equal(atalhoDigitado("/end e mais"), null);
    assert.equal(atalhoDigitado("oi /end"), null);
  });
});
