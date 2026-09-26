import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { nomeExibido, rotuloDoCampo } from "../web/src/formato.js";

/**
 * O que a gaveta do lead mostra. Os dois defeitos vieram de tela, apontados pelo
 * dono: nome do WhatsApp em minusculo e chave do banco no lugar do rotulo.
 */

describe("rotulo dos campos coletados pela IA", () => {
  test("a configuracao do negocio manda", () => {
    assert.equal(rotuloDoCampo("urgencia", { urgencia: "Tem dor / urgência" }), "Tem dor / urgência");
  });

  test("sem configuracao, os conhecidos saem com acento", () => {
    assert.equal(rotuloDoCampo("procedimento_interesse"), "Procedimento de interesse");
    assert.equal(rotuloDoCampo("urgencia"), "Urgência");
  });

  test("chave desconhecida nunca aparece crua", () => {
    assert.equal(rotuloDoCampo("porte_do_pet"), "Porte do pet");
    assert.equal(rotuloDoCampo("horario_preferido"), "Horário preferido");
  });

  test("rotulo vazio na configuracao nao apaga o campo", () => {
    assert.equal(rotuloDoCampo("bairro", { bairro: "  " }), "Bairro");
  });
});

describe("nome do WhatsApp na tela", () => {
  test("minusculo vira capitalizado", () => {
    assert.equal(nomeExibido("paixão"), "Paixão");
    assert.equal(nomeExibido("maria da silva"), "Maria da Silva");
  });

  test("quem escreveu com maiuscula no meio nao e mexido", () => {
    assert.equal(nomeExibido("McDonald"), "McDonald");
  });

  test("vazio continua vazio, para a tela cair no telefone", () => {
    assert.equal(nomeExibido(null), "");
    assert.equal(nomeExibido("   "), "");
  });
});
