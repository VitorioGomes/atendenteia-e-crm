import "./preparar.js";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ehGrupo,
  formatarTelefone,
  jidParaTelefone,
  normalizarTelefone,
  variantesTelefone,
} from "../src/lib/telefone.js";

describe("telefone", () => {
  test("extrai o numero do jid do WhatsApp", () => {
    assert.equal(jidParaTelefone("5511987654321@s.whatsapp.net"), "5511987654321");
    assert.equal(jidParaTelefone("5511987654321:12@s.whatsapp.net"), "5511987654321");
  });

  test("reconhece grupo", () => {
    assert.equal(ehGrupo("120363012345678901@g.us"), true);
    assert.equal(ehGrupo("5511987654321@s.whatsapp.net"), false);
  });

  test("normaliza numero brasileiro sem DDI", () => {
    assert.equal(normalizarTelefone("11987654321"), "5511987654321");
    assert.equal(normalizarTelefone("(11) 98765-4321"), "5511987654321");
    assert.equal(normalizarTelefone("1133334444"), "551133334444");
  });

  test("nao mexe em numero que ja tem DDI", () => {
    assert.equal(normalizarTelefone("5511987654321"), "5511987654321");
    assert.equal(normalizarTelefone("+55 11 98765-4321"), "5511987654321");
  });

  test("gera as duas formas do nono digito", () => {
    // O mesmo contato pode chegar com e sem o 9. Se as variantes falharem,
    // o CRM cria contato duplicado - a falha mais irritante possivel pro dono.
    const comNove = variantesTelefone("5511987654321");
    assert.ok(comNove.includes("5511987654321"));
    assert.ok(comNove.includes("551187654321"));

    const semNove = variantesTelefone("551187654321");
    assert.ok(semNove.includes("5511987654321"));
    assert.ok(semNove.includes("551187654321"));
  });

  test("formata para exibicao no CRM", () => {
    assert.equal(formatarTelefone("5511987654321"), "(11) 98765-4321");
    assert.equal(formatarTelefone("551133334444"), "(11) 3333-4444");
  });
});
