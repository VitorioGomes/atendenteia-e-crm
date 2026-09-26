import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { motivoParaIgnorar } from "../src/atendimento/filtro.js";
import type { MensagemRecebida } from "../src/whatsapp/payload.js";

/**
 * Estes dois casos vieram do PRIMEIRO teste com WhatsApp de verdade (17/09/2026).
 *
 * Ao conectar, quatro mensagens sem texto nenhum viraram contato, card no funil e
 * quatro linhas de "[mensagem enviada pela equipe]" no historico — lixo de protocolo
 * do WhatsApp tratado como conversa. Se isso voltar, o CRM do comprador enche de
 * lead falso no primeiro minuto de uso.
 */

const mensagem = (dados: Partial<MensagemRecebida> = {}): MensagemRecebida => ({
  idExterno: "ABC123",
  telefone: "5511999999999",
  pushName: null,
  daEquipe: false,
  tipo: "TEXT",
  texto: "oi, quanto custa?",
  base64: null,
  mimetype: null,
  nomeArquivo: null,
  tamanho: null,
  recebidaEm: new Date(),
  ...dados,
});

describe("o que entra e o que e ignorado", () => {
  it("mensagem de verdade passa", () => {
    assert.equal(motivoParaIgnorar(mensagem()), null);
  });

  it("aviso de protocolo do WhatsApp nao vira atendimento", () => {
    assert.equal(motivoParaIgnorar(mensagem({ tipo: "UNKNOWN", texto: null })), "sem-conteudo");
  });

  it("mensagem so com espacos tambem nao", () => {
    assert.equal(motivoParaIgnorar(mensagem({ texto: "   " })), "sem-conteudo");
  });

  it("audio passa mesmo sem texto, porque vai ser transcrito", () => {
    assert.equal(motivoParaIgnorar(mensagem({ tipo: "AUDIO", texto: null })), null);
  });

  it("imagem com legenda passa", () => {
    assert.equal(motivoParaIgnorar(mensagem({ tipo: "IMAGE", texto: "[a pessoa enviou uma imagem sem legenda]" })), null);
  });
});

describe("historico do numero nao vira atendimento", () => {
  const agora = new Date("2026-09-17T12:00:00Z");

  it("mensagem de ontem a noite ainda merece resposta", () => {
    const ontem = new Date("2026-09-16T21:00:00Z");
    assert.equal(motivoParaIgnorar(mensagem({ recebidaEm: ontem }), agora), null);
  });

  it("conversa de semana passada e ignorada ao conectar o numero", () => {
    const semanaPassada = new Date("2026-09-10T12:00:00Z");
    assert.equal(motivoParaIgnorar(mensagem({ recebidaEm: semanaPassada }), agora), "antiga");
  });

  it("mensagem com data no futuro (relogio torto do celular) nao e descartada", () => {
    const futuro = new Date("2026-09-17T12:05:00Z");
    assert.equal(motivoParaIgnorar(mensagem({ recebidaEm: futuro }), agora), null);
  });
});
