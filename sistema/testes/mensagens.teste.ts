import "./preparar.js";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  destinoDoFollowup,
  quebrarEmMensagens,
  tirarPerguntaDeCortesia,
} from "../src/atendimento/responder.js";
import { NegocioSchema } from "../src/config/negocio.js";

describe("quebra da resposta em mensagens", () => {
  test("mantem resposta curta como uma mensagem so", () => {
    assert.deepEqual(quebrarEmMensagens("Oi Ana! Tudo bem?"), ["Oi Ana! Tudo bem?"]);
  });

  test("separa paragrafos em mensagens diferentes", () => {
    const partes = quebrarEmMensagens("Oi Ana!\n\nO clareamento sai a partir de R$ 900.");
    assert.equal(partes.length, 2);
    assert.equal(partes[0], "Oi Ana!");
  });

  test("nunca dispara mais de 4 mensagens seguidas", () => {
    // Metralhar o cliente com 7 mensagens e caminho direto pro bloqueio do numero.
    const texto = ["um", "dois", "tres", "quatro", "cinco", "seis", "sete"].join("\n\n");
    const partes = quebrarEmMensagens(texto);
    assert.ok(partes.length <= 4, `gerou ${partes.length} mensagens`);
    assert.ok(partes.join(" ").includes("sete"), "nenhum conteudo pode ser perdido na quebra");
  });

  test("texto vazio nao gera mensagem fantasma", () => {
    assert.deepEqual(quebrarEmMensagens("   "), [""]);
  });
});

describe("uma pergunta por resposta", () => {
  test("tira o 'como posso ajudar' quando ha pergunta de verdade junto", () => {
    // O caso real, com acento e emoji como saiu no WhatsApp: a pessoa manda "Oi" e
    // recebe duas perguntas de volta.
    const texto =
      "Oi! 👋 Sou Marina, assistente virtual da Clínica Sorriso Vivo. Como posso ajudar você?\n\n" +
      "Antes de tudo, qual é o seu nome?";
    const saida = tirarPerguntaDeCortesia(texto);

    assert.equal((saida.match(/\?/g) ?? []).length, 1);
    assert.ok(!/posso ajudar/i.test(saida));
    assert.ok(saida.includes("qual é o seu nome?"), "a pergunta util tem que sobreviver");
    assert.ok(saida.includes("Sou Marina"), "a apresentacao nao pode ir junto");
    assert.ok(saida.includes("👋"), "o emoji da apresentacao continua no lugar");
  });

  test("pega as outras formas de dizer a mesma cortesia", () => {
    for (const cortesia of [
      "Em que posso te ajudar hoje?",
      "Como posso lhe ajudar?",
      "No que posso ajudar?",
    ]) {
      const saida = tirarPerguntaDeCortesia(`Oi! Sou a Marina. ${cortesia}\n\nQual é o seu nome?`);
      assert.equal((saida.match(/\?/g) ?? []).length, 1, cortesia);
    }
  });

  test("sozinha, a cortesia fica: e ela que abre a conversa", () => {
    const texto = "Oi! Sou a Marina. Como posso ajudar voce?";
    assert.equal(tirarPerguntaDeCortesia(texto), texto);
  });

  test("oferta de verdade com 'ajudar' nao e cortesia", () => {
    const texto =
      "Temos clareamento e limpeza.\n\nPosso te ajudar a escolher entre os dois, ou voce ja sabe?";
    assert.equal(tirarPerguntaDeCortesia(texto), texto);
  });

  test("nao deixa paragrafo vazio nem mensagem fantasma", () => {
    const texto = "Como posso ajudar?\n\nQual e o seu nome?";
    const partes = quebrarEmMensagens(tirarPerguntaDeCortesia(texto));
    assert.deepEqual(partes, ["Qual e o seu nome?"]);
  });
});

describe("validacao do negocio.json", () => {
  test("recusa funil com menos de dois estagios", () => {
    const resultado = NegocioSchema.safeParse({
      negocio: { nome: "Teste" },
      atendente: { nome: "Bot" },
      horarios: { atendimento: {} },
      objetivo: { principal: "vender" },
      funil: { estagios: [{ chave: "novo", nome: "Novo" }] },
    });
    assert.equal(resultado.success, false);
  });

  test("recusa chave de estagio com maiuscula ou espaco", () => {
    const base = {
      negocio: { nome: "Teste" },
      atendente: { nome: "Bot" },
      horarios: { atendimento: {} },
      objetivo: { principal: "vender" },
    };

    const comEspaco = NegocioSchema.safeParse({
      ...base,
      funil: { estagios: [{ chave: "novo lead", nome: "Novo" }, { chave: "fim", nome: "Fim" }] },
    });
    assert.equal(comEspaco.success, false);
  });

  test("recusa horario mal escrito", () => {
    const resultado = NegocioSchema.safeParse({
      negocio: { nome: "Teste" },
      atendente: { nome: "Bot" },
      horarios: { atendimento: { seg: [["9h", "18h"]] } },
      objetivo: { principal: "vender" },
      funil: { estagios: [{ chave: "a", nome: "A" }, { chave: "b", nome: "B" }] },
    });
    assert.equal(resultado.success, false, "'9h' precisa ser recusado; o formato e 09:00");
  });

  test("preenche os padroes de um negocio.json minimo", () => {
    const resultado = NegocioSchema.safeParse({
      negocio: { nome: "Barbearia do Ze" },
      atendente: { nome: "Ju" },
      horarios: { atendimento: { seg: [["09:00", "18:00"]] } },
      objetivo: { principal: "agendar corte" },
      funil: { estagios: [{ chave: "novo", nome: "Novo" }, { chave: "fechado", nome: "Fechado" }] },
    });

    assert.equal(resultado.success, true);
    if (!resultado.success) return;

    // Um negocio.json enxuto tem que funcionar: e o que a skill gera no Modo Guiado.
    assert.equal(resultado.data.agenda.ativo, false);
    assert.equal(resultado.data.followup.ativo, false);
    assert.equal(resultado.data.atendente.emojis, "poucos");
    assert.equal(resultado.data.horarios.atendimento.dom.length, 0);
    assert.equal(resultado.data.conformidade.avisarQueEhIA, true);
  });
});

describe("quem ja tem horario nao recebe follow-up", () => {
  const situacao = (parcial: Partial<Parameters<typeof destinoDoFollowup>[0]> = {}) =>
    destinoDoFollowup({
      transferiuParaHumano: false,
      ehLembrete: false,
      temAgendamento: false,
      agendouAgora: false,
      cancelouAgora: false,
      ...parcial,
    });

  test("acabou de marcar: o follow-up pendente sai", () => {
    // O defeito achado no banco em 20/09: a pessoa marcava de manha e recebia
    // "ainda tem interesse?" a tarde, com a consulta marcada para o dia seguinte.
    assert.equal(situacao({ agendouAgora: true }), "cancelar");
  });

  test("marcou antes e voltou so para tirar duvida: continua sem follow-up", () => {
    assert.equal(situacao({ temAgendamento: true }), "cancelar");
  });

  test("desmarcou agora: volta a valer, porque ela ficou sem horario", () => {
    assert.equal(situacao({ temAgendamento: true, cancelouAgora: true }), "agendar");
  });

  test("humano assumiu: nada de robo por cima", () => {
    assert.equal(situacao({ transferiuParaHumano: true }), "cancelar");
  });

  test("depois do lembrete nao se cutuca de novo", () => {
    assert.equal(situacao({ ehLembrete: true }), "nada");
  });

  test("conversa comum sem horario: segue com follow-up", () => {
    assert.equal(situacao(), "agendar");
  });
});
