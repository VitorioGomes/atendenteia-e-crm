import "./preparar.js";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { prometeuRetornoDoTime, textoDaPergunta } from "../src/atendimento/aviso-equipe.js";
import { resumoProvisorio } from "../src/crm/resumo-provisorio.js";
import { definirFerramentas } from "../src/agente/ferramentas.js";
import { montarSystem } from "../src/agente/prompt.js";
import type { EstadoDoLead } from "../src/agente/prompt.js";
import { negocioExemplo } from "./fixtures.js";

/**
 * Terceiro teste da skill (27/09/2026): infoproduto com site e Instagram, instalado
 * clonando do GitHub. Cada bloco aqui e um defeito que apareceu na conversa real.
 */

function lead(parcial: Partial<EstadoDoLead> = {}): EstadoDoLead {
  return {
    nome: "Vitorio",
    telefone: "5511987654321",
    estagioAtual: "qualificando",
    estagioNome: "Qualificando",
    resumo: null,
    camposConhecidos: {},
    tags: [],
    primeiraConversa: false,
    ...parcial,
  };
}

describe("'vou confirmar com o time' e ninguem ficava sabendo", () => {
  test("a promessa de retorno e reconhecida nos jeitos que a IA escreve", () => {
    assert.ok(prometeuRetornoDoTime("Boa pergunta. Vou confirmar isso com o time e já te retorno."));
    assert.ok(prometeuRetornoDoTime("Vou verificar com a equipe e te aviso"));
    assert.ok(prometeuRetornoDoTime("Deixa eu confirmar com o pessoal"));
  });

  test("resposta comum nao dispara aviso", () => {
    assert.ok(!prometeuRetornoDoTime("Pronto, marquei para quinta-feira às 09:00!"));
    assert.ok(!prometeuRetornoDoTime("Pode confirmar o horário?"));
    assert.ok(!prometeuRetornoDoTime("O time vai te chamar na call"));
  });

  test("o aviso diz quem perguntou, o que perguntou e que a IA segue atendendo", () => {
    const texto = textoDaPergunta({
      atendente: "Bruno",
      cliente: "João Pereira",
      telefone: "5511990001234",
      pergunta: "precisa ter CNPJ?",
    });
    assert.match(texto, /Bruno não soube responder/);
    assert.match(texto, /João Pereira, \(11\) 99000-1234/);
    assert.match(texto, /Pergunta: precisa ter CNPJ\?/);
    assert.match(texto, /continua atendendo/);
    assert.doesNotMatch(texto, /—/, "sem travessao");
  });

  test("avisar_equipe existe e transferir_humano manda usar ela para duvida simples", async () => {
    const ferramentas = definirFerramentas(await negocioExemplo());
    const avisar = ferramentas.find((f) => f.name === "avisar_equipe");
    assert.ok(avisar, "falta a ferramenta avisar_equipe");
    assert.deepEqual((avisar!.input_schema as any).required, ["pergunta"]);
    const transferir = ferramentas.find((f) => f.name === "transferir_humano");
    assert.match(transferir!.description!, /avisar_equipe/);
  });

  test("a regra anti-invencao manda chamar avisar_equipe, nao so prometer", async () => {
    const texto = montarSystem(await negocioExemplo(), lead())[0]!.text;
    assert.match(texto, /Chame avisar_equipe/);
    assert.match(texto, /Nunca diga que vai confirmar sem chamar a ferramenta/);
  });
});

describe("pediu desconto, que era motivo de chamar o dono, e a IA respondeu sozinha", () => {
  test("os motivos de chamar a equipe valem mesmo quando a IA sabe a resposta", async () => {
    const texto = montarSystem(await negocioExemplo(), lead())[0]!.text;
    assert.match(texto, /Vale MESMO QUE voce saiba a resposta/);
  });
});

describe("o CRM so foi atualizado no fim da conversa", () => {
  test("atualizar_lead leva o resumo junto, e obrigatorio", async () => {
    const atualizar = definirFerramentas(await negocioExemplo()).find(
      (f) => f.name === "atualizar_lead",
    )!;
    const esquema = atualizar.input_schema as any;
    assert.ok(esquema.properties.resumo, "atualizar_lead precisa aceitar resumo");
    assert.deepEqual(esquema.required, ["resumo"]);
  });

  test("sem resumo, o prompt lembra a cada rodada; com resumo, mostra o que existe", async () => {
    const config = await negocioExemplo();
    const semResumo = montarSystem(config, lead())[1]!.text;
    assert.match(semResumo, /O CRM ainda NAO tem resumo/);

    const comResumo = montarSystem(config, lead({ resumo: "Gestor de tráfego, fatura 4 mil" }))[1]!.text;
    assert.doesNotMatch(comResumo, /O CRM ainda NAO tem resumo/);
    assert.match(comResumo, /Gestor de tráfego, fatura 4 mil/);
  });

  test("o lembrete do resumo fica fora do bloco cacheado", async () => {
    const config = await negocioExemplo();
    const a = montarSystem(config, lead())[0]!.text;
    const b = montarSystem(config, lead({ resumo: "algo" }))[0]!.text;
    assert.equal(a, b, "o bloco estavel mudou com o resumo: quebraria o cache do prompt");
  });
});

describe("card vazio enquanto a IA nao escrevia o resumo", () => {
  const base = {
    estagioNome: "Qualificando",
    primeiroEstagio: false,
    temMensagem: true,
    campos: [] as Array<string | null>,
    etiquetas: [] as string[],
    agendamento: null,
    timezone: "America/Sao_Paulo",
  };

  test("lead que ainda nao falou", () => {
    assert.equal(
      resumoProvisorio({ ...base, primeiroEstagio: true, temMensagem: false }),
      "Lead novo, ainda sem conversa",
    );
  });

  test("lead que falou mas nao disse nada ainda", () => {
    assert.equal(resumoProvisorio({ ...base, primeiroEstagio: true }), "Lead novo, começou a conversa");
    assert.equal(resumoProvisorio(base), "Qualificando, em conversa");
  });

  test("com o que a IA coletou, sem repetir e no maximo tres dados", () => {
    assert.equal(
      resumoProvisorio({
        ...base,
        campos: ["gestor de tráfego", "4 mil por mês", null, "quer começar logo"],
        etiquetas: ["gestor de tráfego", "com pressa"],
      }),
      "Qualificando: gestor de tráfego, 4 mil por mês, quer começar logo",
    );
  });

  test("compromisso marcado manda na frase, com 'na' e 'no' certos", () => {
    // 01/10/2026 e quinta; 03/10/2026 e sabado.
    const quinta = new Date("2026-10-01T12:00:00Z"); // 09:00 em Sao Paulo
    const sabado = new Date("2026-10-03T12:00:00Z");
    assert.equal(
      resumoProvisorio({ ...base, agendamento: { servico: "Call de diagnóstico", quando: quinta } }),
      "Call de diagnóstico na quinta-feira, 01/10 às 09:00",
    );
    assert.match(
      resumoProvisorio({ ...base, agendamento: { servico: "Banho", quando: sabado } }),
      /^Banho no sábado, 03\/10 às 09:00$/,
    );
  });
});
