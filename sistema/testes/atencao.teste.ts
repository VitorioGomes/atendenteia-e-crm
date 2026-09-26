import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { estaEsperando, precisaDeVoce, type EstadoConversa } from "../src/crm/atencao.js";

/**
 * Quando a conversa precisa de uma pessoa. E o que acende o laranja na caixa de
 * entrada e o numero na barra lateral — se errar para mais, o dono aprende a ignorar;
 * se errar para menos, lead fica sem resposta.
 */

const agora = new Date("2026-09-18T15:00:00Z");
const minutosAtras = (m: number) => new Date(agora.getTime() - m * 60_000);

const conversa = (dados: Partial<EstadoConversa> = {}): EstadoConversa => ({
  mode: "BOT",
  botPausedUntil: null,
  lastInboundAt: minutosAtras(1),
  lastOutboundAt: null,
  ...dados,
});

describe("quando uma conversa precisa de uma pessoa", () => {
  it("mensagem que acabou de chegar, com a IA ligada: nao (ela vai responder)", () => {
    assert.equal(precisaDeVoce(conversa({ lastInboundAt: minutosAtras(0.5) }), agora), false);
  });

  it("IA ligada, mesmo demorando: nao — o laranja e so para conversa com voce", () => {
    // Ate 26/09/2026, mais de 3 minutos sem resposta acendia o laranja (sinal de
    // falha da IA). O dono tirou: o laranja quer dizer "esta com voce e alguem espera".
    assert.equal(precisaDeVoce(conversa({ lastInboundAt: minutosAtras(30) }), agora), false);
  });

  it("conversa com a equipe e alguem esperando: sim, na hora", () => {
    assert.equal(precisaDeVoce(conversa({ mode: "HUMAN", lastInboundAt: minutosAtras(0.2) }), agora), true);
  });

  it("IA pausada porque alguem respondeu pelo celular: sim", () => {
    const pausada = conversa({ botPausedUntil: new Date(agora.getTime() + 30 * 60_000) });
    assert.equal(precisaDeVoce(pausada, agora), true);
  });

  it("pausa que ja venceu nao conta: a IA voltou", () => {
    const vencida = conversa({ botPausedUntil: minutosAtras(10), lastInboundAt: minutosAtras(0.5) });
    assert.equal(precisaDeVoce(vencida, agora), false);
  });

  it("ja respondida: nao, mesmo com a equipe", () => {
    const respondida = conversa({
      mode: "HUMAN",
      lastInboundAt: minutosAtras(10),
      lastOutboundAt: minutosAtras(2),
    });
    assert.equal(precisaDeVoce(respondida, agora), false);
  });

  it("conversa que so teve mensagem nossa (lembrete, por exemplo): nao", () => {
    assert.equal(
      precisaDeVoce(conversa({ lastInboundAt: null, lastOutboundAt: minutosAtras(5) }), agora),
      false,
    );
  });
});

describe("esperando resposta", () => {
  it("pessoa escreveu depois da nossa ultima mensagem", () => {
    assert.equal(estaEsperando(conversa({ lastOutboundAt: minutosAtras(3) })), true);
  });

  it("nossa mensagem foi a ultima", () => {
    assert.equal(
      estaEsperando(conversa({ lastInboundAt: minutosAtras(3), lastOutboundAt: minutosAtras(1) })),
      false,
    );
  });
});
