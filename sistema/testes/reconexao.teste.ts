import "./preparar.js";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DisconnectReason } from "baileys";
import { acaoAoCair } from "../src/whatsapp/conexao.js";

/**
 * Do teste real de 20/09/2026: o dono leu o QR Code, o WhatsApp conectou, e em dois
 * minutos e meio o sistema conectou 20 vezes e caiu 52. O motivo era 440, "outro
 * aparelho assumiu esta sessao" — e a versao antiga reconectava em tudo que nao
 * fosse "deslogado", entao cada queda virava um revide.
 *
 * Mais quedas do que conexoes e a assinatura de um laco se alimentando. E esse
 * vai-e-vem e justamente o comportamento que faz a Meta banir o numero do comprador.
 */

const queda = (motivo?: number, extra: { desligadoDeProposito?: boolean; tentativasAnteriores?: number } = {}) =>
  acaoAoCair({
    motivo,
    desligadoDeProposito: extra.desligadoDeProposito ?? false,
    tentativasAnteriores: extra.tentativasAnteriores ?? 0,
  });

describe("o que fazer quando a conexao do WhatsApp cai", () => {
  test("outro aparelho assumiu: PARA, nunca revida", () => {
    const acao = queda(DisconnectReason.connectionReplaced);

    assert.equal(acao.tipo, "parar", "reconectar aqui e brigar pelo numero do comprador");
    if (acao.tipo !== "parar") return;
    assert.match(acao.motivo, /outros aparelhos/i, "a tela precisa dizer o que fazer");
  });

  test("deslogado ou recusado: apaga a sessao e pede QR Code novo", () => {
    for (const motivo of [DisconnectReason.loggedOut, DisconnectReason.forbidden]) {
      assert.equal(queda(motivo).tipo, "limpar_sessao", String(motivo));
    }
  });

  test("515 faz parte do pareamento: reconecta na hora e nao conta como falha", () => {
    // Sem isto, ler o QR Code gastaria uma das tentativas logo de cara.
    const acao = queda(DisconnectReason.restartRequired);

    assert.equal(acao.tipo, "reconectar");
    if (acao.tipo !== "reconectar") return;
    assert.ok(acao.emMs < 1000, "esperar aqui atrasa o pareamento sem motivo");
    assert.equal(acao.contaTentativa, false);
  });

  test("desligado pelo CRM nao reconecta sozinho", () => {
    assert.equal(queda(undefined, { desligadoDeProposito: true }).tipo, "nada");
  });

  test("queda de rede: espera dobrando, com teto", () => {
    const esperas = [0, 1, 2, 3, 20].map((n) => {
      const acao = queda(DisconnectReason.connectionClosed, { tentativasAnteriores: n });
      return acao.tipo === "reconectar" ? acao.emMs : null;
    });

    assert.deepEqual(esperas.slice(0, 4), [5_000, 10_000, 20_000, 40_000]);
    assert.equal(esperas[4], null, "depois de muitas tentativas tem que desistir, nao insistir");
  });

  test("desiste depois de oito quedas seguidas", () => {
    assert.equal(queda(DisconnectReason.connectionClosed, { tentativasAnteriores: 7 }).tipo, "reconectar");

    const nona = queda(DisconnectReason.connectionClosed, { tentativasAnteriores: 8 });
    assert.equal(nona.tipo, "parar");
    if (nona.tipo !== "parar") return;
    assert.match(nona.motivo, /QR Code/i);
  });

  test("motivo desconhecido ainda tenta de novo", () => {
    // Nem toda queda vem com codigo. Ficar mudo por isso seria pior.
    assert.equal(queda(undefined).tipo, "reconectar");
  });
});
