import "./preparar.js";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { montarSystem, perguntaDePeriodo } from "../src/agente/prompt.js";

/** Escritos por codigo: escrever "
" a mao ja se perdeu uma vez neste projeto. */
const QUEBRA = String.fromCharCode(10);
const TRAVESSAO = String.fromCharCode(8212);
import type { EstadoDoLead } from "../src/agente/prompt.js";
import { DateTime } from "luxon";
import { confirmacaoDoAgendamento, definirFerramentas } from "../src/agente/ferramentas.js";
import { negocioExemplo } from "./fixtures.js";
import { nomeDoPerfil } from "../src/atendimento/responder.js";

function lead(parcial: Partial<EstadoDoLead> = {}): EstadoDoLead {
  return {
    nome: null,
    telefone: "5511987654321",
    estagioAtual: "novo_lead",
    estagioNome: "Novo lead",
    resumo: null,
    camposConhecidos: {},
    tags: [],
    primeiraConversa: true,
    ...parcial,
  };
}

describe("prompt do atendente", () => {
  test("o bloco cacheado e identico para leads diferentes", async () => {
    // ESTE E O TESTE MAIS IMPORTANTE DO SISTEMA.
    // Se qualquer coisa variavel (nome, data, estagio) vazar pro primeiro bloco,
    // o cache do prompt para de funcionar e a conta da IA do comprador multiplica.
    const config = await negocioExemplo();

    const a = montarSystem(config, lead({ nome: "Ana", estagioAtual: "qualificando" }));
    const b = montarSystem(
      config,
      lead({
        nome: "Bruno",
        estagioAtual: "agendado",
        resumo: "quer implante",
        camposConhecidos: { convenio: "Amil" },
        tags: ["urgente"],
        primeiraConversa: false,
      }),
    );

    assert.equal(a[0]?.text, b[0]?.text, "o bloco estavel do prompt mudou entre dois leads");
    assert.notEqual(a[1]?.text, b[1]?.text, "o bloco dinamico deveria variar por lead");
  });

  test("a atendente fala de si no genero configurado", async () => {
    // O aviso de IA dizia "uma assistente virtual" ate para o atendente masculino.
    const config = await negocioExemplo();
    const comGenero = (genero: "feminino" | "masculino" | "neutro") => {
      const c = { ...config, negocio: { ...config.negocio, atendente: { ...config.negocio.atendente, genero } } };
      return montarSystem(c, lead()).map((b) => b.text).join("\n");
    };

    assert.match(comGenero("feminino"), /uma assistente virtual/);
    assert.match(comGenero("feminino"), /use o feminino/);
    const masculino = comGenero("masculino");
    assert.match(masculino, /um assistente virtual/);
    assert.match(masculino, /use o masculino/);
    assert.doesNotMatch(masculino, /uma assistente virtual/);
    assert.doesNotMatch(comGenero("neutro"), /uma assistente virtual|um assistente virtual/);
  });

  test("o bloco estavel pede cache e o dinamico nao", async () => {
    const config = await negocioExemplo();
    const system = montarSystem(config, lead());

    assert.equal(system.length, 2);
    assert.deepEqual(system[0]?.cache_control, { type: "ephemeral" });
    assert.equal(system[1]?.cache_control, undefined);
  });

  test("nenhuma data ou hora vaza para o bloco cacheado", async () => {
    const config = await negocioExemplo();
    const estavel = montarSystem(config, lead())[0]?.text ?? "";

    // Data no formato dd/mm/aaaa e hora hh:mm sao os vazamentos classicos.
    assert.doesNotMatch(estavel, /\d{2}\/\d{2}\/\d{4}/, "data vazou para o bloco cacheado");
    assert.doesNotMatch(estavel, /\bAgora sao\b/, "hora atual vazou para o bloco cacheado");

    // Ja o bloco dinamico PRECISA ter a data.
    const dinamico = montarSystem(config, lead())[1]?.text ?? "";
    assert.match(dinamico, /\d{2}\/\d{2}\/\d{4}/);
  });

  test("o conhecimento do negocio entra inteiro no prompt", async () => {
    const config = await negocioExemplo();
    const estavel = montarSystem(config, lead())[0]?.text ?? "";

    assert.ok(estavel.includes("Amil Dental"), "o conhecimento.md nao entrou no prompt");
    assert.ok(estavel.includes("Sorriso Vivo"), "o nome da empresa nao entrou");
    assert.ok(estavel.includes("Marina"), "o nome da atendente nao entrou");

    // A regra anti-invencao e o que separa um atendente util de um que promete
    // preco e prazo que nao existem. Se ela sumir do prompt, o produto vira problema.
    assert.ok(estavel.includes("Regra anti-invencao"), "o bloco anti-invencao sumiu do prompt");
    assert.ok(estavel.includes("NAO chute e NAO invente"));
    assert.ok(estavel.includes("transferir_humano"), "a saida para humano nao foi instruida");
  });

  test("o funil configurado chega ao prompt e as ferramentas", async () => {
    const config = await negocioExemplo();
    const estavel = montarSystem(config, lead())[0]?.text ?? "";

    for (const estagio of config.negocio.funil.estagios) {
      assert.ok(estavel.includes(estagio.chave), `estagio ${estagio.chave} faltou no prompt`);
    }

    const ferramentas = definirFerramentas(config);
    const mover = ferramentas.find((f) => f.name === "mover_estagio");
    const enumerado = (mover?.input_schema.properties as any)?.estagio?.enum as string[];

    assert.deepEqual(
      enumerado,
      config.negocio.funil.estagios
        .filter((e) => !e.aoAgendar && !e.somenteEquipe)
        .map((e) => e.chave),
      "a IA precisa receber os estagios que ela pode mover, senao move o card pra lugar nenhum",
    );
  });

  test("a IA nao consegue marcar como agendado nem como compareceu", async () => {
    // Do primeiro teste real (18/09/2026): a IA moveu o card para "Avaliacao
    // agendada" com o motivo "esta pronto para agendar", e nenhum agendamento
    // existia. Regra em texto nao segurou; opcao fora do enum, ela nao escolhe.
    const config = await negocioExemplo();
    const mover = definirFerramentas(config).find((f) => f.name === "mover_estagio");
    const enumerado = (mover?.input_schema.properties as any)?.estagio?.enum as string[];

    const agendado = config.negocio.funil.estagios.find((e) => e.aoAgendar);
    const daEquipe = config.negocio.funil.estagios.filter((e) => e.somenteEquipe);

    assert.ok(agendado, "o exemplo precisa ter um estagio de agendamento marcado");
    assert.ok(!enumerado.includes(agendado.chave), "a IA nao pode escolher o estagio de agendado");
    for (const e of daEquipe) {
      assert.ok(!enumerado.includes(e.chave), `a IA nao pode escolher "${e.chave}"`);
    }
  });

  test("a IA nunca e instruida a anunciar que esta fora do horario", async () => {
    const config = await negocioExemplo();
    const [estavel, dinamico] = montarSystem(config, lead()).map((b) => b.text);
    const tudo = `${estavel}\n${dinamico}`.toLowerCase();

    assert.ok(tudo.includes("24 horas"), "a IA precisa saber que atende 24h");
    assert.ok(!tudo.includes("esta fechada neste momento"), "texto antigo de 'fechado' voltou");
    assert.ok(!tudo.includes("use algo na linha de"), "a mensagem pronta de fora do horario voltou");
  });

  test("agenda desligada remove as ferramentas de agendamento", async () => {
    const config = await negocioExemplo();

    const DE_AGENDA = [
      "consultar_horarios",
      "agendar",
      "remarcar_agendamento",
      "cancelar_agendamento",
    ];

    const comAgenda = definirFerramentas(config).map((f) => f.name);
    for (const ferramenta of DE_AGENDA) {
      assert.ok(comAgenda.includes(ferramenta), `faltou ${ferramenta} com a agenda ligada`);
    }

    const semAgenda = definirFerramentas({
      ...config,
      negocio: { ...config.negocio, agenda: { ...config.negocio.agenda, ativo: false } },
    }).map((f) => f.name);

    for (const ferramenta of DE_AGENDA) {
      assert.ok(!semAgenda.includes(ferramenta), `${ferramenta} vazou com a agenda desligada`);
    }
    // As de CRM continuam sempre.
    assert.ok(semAgenda.includes("atualizar_lead"));
    assert.ok(semAgenda.includes("transferir_humano"));
  });

  test("a IA e mandada agendar na escolha, sem confirmar de novo", async () => {
    // No teste real a pessoa escolheu 09:00, a IA perguntou "so para confirmar?", ela
    // disse "Sim" — e a IA consultou a agenda de novo em vez de marcar. Nada foi marcado.
    const config = await negocioExemplo();
    const estavel = montarSystem(config, lead())[0]?.text ?? "";

    assert.ok(estavel.includes("Como marcar horario"), "o roteiro da agenda sumiu do prompt");
    // A IA perguntou o periodo antes de dizer que existia uma avaliacao gratuita: a
    // pessoa escolheu horario para uma coisa que ela nao sabia que existia.
    assert.ok(
      estavel.includes(`O que voce marca e: ${config.negocio.objetivo.principal}`),
      "o prompt precisa dizer o que esta sendo marcado",
    );
    assert.match(estavel, /Espere ela aceitar/i, "falta pedir o sim antes do horario");
    assert.match(estavel, /escolha dela JA E a confirmacao/i);
    assert.match(estavel, /NUNCA consulte a agenda de novo/i);
    assert.match(estavel, /deixa eu consultar/i, "falta proibir a narracao do processo");

    const semAgenda = montarSystem(
      { ...config, negocio: { ...config.negocio, agenda: { ...config.negocio.agenda, ativo: false } } },
      lead(),
    )[0]?.text;
    assert.ok(!semAgenda?.includes("Como marcar horario"), "roteiro de agenda sem agenda ligada");
  });

  test("o estado do lead aparece no bloco dinamico", async () => {
    const config = await negocioExemplo();
    const dinamico =
      montarSystem(
        config,
        lead({
          nome: "Ana",
          camposConhecidos: { convenio: "Amil", procedimento_interesse: "lentes" },
          primeiraConversa: false,
        }),
      )[1]?.text ?? "";

    assert.ok(dinamico.includes("Ana"));
    assert.ok(dinamico.includes("Amil"));
    assert.ok(dinamico.includes("lentes"));
    assert.ok(
      dinamico.includes("NAO pergunte de novo"),
      "sem essa instrucao a IA repergunta o que ja sabe - o defeito que mais irrita cliente",
    );
  });

  test("a IA e avisada de que a pessoa ja tem horario marcado", async () => {
    // Sem isto ela marca um SEGUNDO horario em vez de remarcar o que existe,
    // e a pessoa fica com duas vagas presas no nome dela.
    const config = await negocioExemplo();
    const dinamico =
      montarSystem(
        config,
        lead({
          nome: "Carlos",
          primeiraConversa: false,
          agendamentoAtual: { servico: "Avaliação", quando: "quinta-feira, 11/09 as 10:00" },
        }),
      )[1]?.text ?? "";

    assert.ok(dinamico.includes("JA TEM horario marcado"));
    assert.ok(dinamico.includes("quinta-feira, 11/09 as 10:00"));
    assert.ok(dinamico.includes("remarcar_agendamento"));
    assert.ok(dinamico.includes("cancelar_agendamento"));
  });

  test("lembrete deixa claro que a IA esta iniciando a conversa", async () => {
    const config = await negocioExemplo();
    const dinamico =
      montarSystem(
        config,
        lead({
          primeiraConversa: false,
          ehLembrete: {
            servico: "Avaliação",
            quando: "sexta-feira, 12/09 as 14:00",
            instrucao: "peca confirmacao",
          },
        }),
      )[1]?.text ?? "";

    assert.ok(dinamico.includes("LEMBRETE"));
    assert.ok(dinamico.includes("peca confirmacao"));
    assert.ok(
      dinamico.includes("nao te perguntou nada agora"),
      "sem esse aviso a IA responde como se estivesse continuando a conversa",
    );
  });

  test("follow-up injeta a instrucao da tentativa", async () => {
    const config = await negocioExemplo();
    const dinamico =
      montarSystem(
        config,
        lead({ primeiraConversa: false, ehFollowup: { tentativa: 2, instrucao: "traga urgencia" } }),
      )[1]?.text ?? "";

    assert.ok(dinamico.includes("FOLLOW-UP"));
    assert.ok(dinamico.includes("traga urgencia"));
    assert.ok(dinamico.includes("tentativa 2"));
  });
});

describe("o nome da pessoa", () => {
  // Em duas conversas seguidas a IA abriu de jeitos diferentes: uma perguntando o
  // nome, outra "como posso ajudar". A abertura nao pode ser sorteada.
  test("nao pergunta o nome que o WhatsApp ja deu", async () => {
    const config = await negocioExemplo();
    const dinamico = montarSystem(
      config,
      lead({ nome: null, nomeWhatsapp: "Vitorio Augusto" }),
    )[1]?.text;

    assert.ok(dinamico?.includes("Vitorio Augusto"));
    assert.match(dinamico ?? "", /NAO pergunte o nome/i);
  });

  test("sem nome nenhum, pergunta depois do que a pessoa precisa", async () => {
    const config = await negocioExemplo();
    const dinamico = montarSystem(config, lead({ nome: null, nomeWhatsapp: null }))[1]?.text;

    assert.match(dinamico ?? "", /Pergunte depois que ela ja tiver dito o assunto/i);
  });

  test("a primeira mensagem sempre abre pelo que a pessoa precisa", async () => {
    const config = await negocioExemplo();
    const dinamico = montarSystem(config, lead({ primeiraConversa: true }))[1]?.text ?? "";

    // "O que voce precisa?" saiu assim na tela porque estava assim no prompt: o
    // modelo copia as palavras que recebe. O dono pediu a forma cordial.
    assert.match(dinamico, /Como posso ajudar voce\?/i);
    assert.match(dinamico, /NUNCA escreva "o que voce precisa\?"/i);
    assert.match(dinamico, /NAO peca o nome agora/i);
  });

  test("com nome confirmado, nada disso aparece", async () => {
    const config = await negocioExemplo();
    const dinamico = montarSystem(config, lead({ nome: "Ana", nomeWhatsapp: "Aninha" }))[1]?.text;

    assert.ok(dinamico?.includes("Nome: Ana"));
    assert.ok(!dinamico?.includes("Aninha"), "o nome confirmado manda, nao o do perfil");
  });
});

describe("nome do perfil do WhatsApp", () => {
  test("aceita nome de gente e recusa o que nao da pra chamar", () => {
    assert.equal(nomeDoPerfil("Vitorio"), "Vitorio");
    assert.equal(nomeDoPerfil("  Ana Paula  "), "Ana Paula");

    assert.equal(nomeDoPerfil(null), null);
    assert.equal(nomeDoPerfil("."), null);
    assert.equal(nomeDoPerfil("+55 11 99999-9999"), null, "telefone nao e nome");
    assert.equal(nomeDoPerfil("A"), null, "uma letra nao da pra chamar ninguem");
    assert.equal(nomeDoPerfil("x".repeat(60)), null, "nome de loja gigante nao serve");
  });
});

describe("como a atendente escreve (vale para todo negocio)", () => {
  test("proibe travessao, e o proprio prompt nao usa nenhum", async () => {
    // O modelo copia o que recebe: o travessao saia dele porque estava aqui dentro.
    const config = await negocioExemplo();
    const [estavel, dinamico] = montarSystem(config, lead()).map((b) => b.text ?? "");

    assert.match(estavel, /Nao use travessao/i);
    for (const [onde, texto] of [["estavel", estavel], ["dinamico", dinamico]] as const) {
      const linhas = texto.split(QUEBRA).filter((l) => l.includes(TRAVESSAO));
      assert.deepEqual(linhas, [], `o prompt ${onde} ensina travessao pelo exemplo`);
    }
  });

  test("proibe pergunta cortada e da a forma cordial", async () => {
    const config = await negocioExemplo();
    const estavel = montarSystem(config, lead())[0]?.text ?? "";

    assert.match(estavel, /Pergunta inteira, nunca cortada/i);
    assert.match(estavel, /Voce gostaria de marcar um horario\?/i);
    // A frase quebra de linha dentro do prompt, entao confere so o fim dela.
    assert.match(estavel, /fica melhor para voce\?/i);
  });
});

describe("politica de preco (config, nao codigo)", () => {
  const comPolitica = async (falarDePreco: "so_se_perguntarem" | "pode_falar" | "nunca") => {
    const config = await negocioExemplo();
    return (
      montarSystem(
        {
          ...config,
          negocio: { ...config.negocio, atendente: { ...config.negocio.atendente, falarDePreco } },
        },
        lead(),
      )[0]?.text ?? ""
    );
  };

  test("o padrao e so falar de preco se perguntarem", async () => {
    const config = await negocioExemplo();
    assert.equal(config.negocio.atendente.falarDePreco, "so_se_perguntarem");
    assert.match(await comPolitica("so_se_perguntarem"), /nao traga o assunto/i);
  });

  test("cada politica muda a instrucao", async () => {
    assert.match(await comPolitica("pode_falar"), /Pode falar de valor/i);
    assert.match(await comPolitica("nunca"), /Nao fale de valor em hipotese nenhuma/i);
  });
});

describe("a pergunta de periodo sai do horario configurado", () => {
  test("clinica que abre de manha e a tarde nao oferece noite", async () => {
    const { negocio } = await negocioExemplo();
    assert.equal(perguntaDePeriodo(negocio), "Voce prefere de manha ou a tarde?");
  });

  test("quem so abre de manha pergunta o dia, nao o periodo", async () => {
    const { negocio } = await negocioExemplo();
    const soManha = {
      ...negocio,
      horarios: {
        ...negocio.horarios,
        atendimento: { ...negocio.horarios.atendimento, seg: [["08:00", "12:00"]] as [string, string][],
          ter: [], qua: [], qui: [], sex: [], sab: [], dom: [] },
      },
    };
    assert.equal(perguntaDePeriodo(soManha), "Que dia fica melhor para voce?");
  });

  test("quem fica aberto ate tarde da noite oferece os tres", async () => {
    const { negocio } = await negocioExemplo();
    const ateTarde = {
      ...negocio,
      horarios: {
        ...negocio.horarios,
        atendimento: { ...negocio.horarios.atendimento, seg: [["09:00", "22:00"]] as [string, string][] },
      },
    };
    assert.equal(perguntaDePeriodo(ateTarde), "Voce prefere de manha, a tarde ou a noite?");
  });
});

describe("o que a IA nao pode improvisar", () => {
  test("elogio inventado ao servico esta proibido", async () => {
    // Saiu "Clareamento e um dos nossos especialistas": a frase sem sentido nasceu
    // da tentativa de enfeitar o servico, nao de falta de gramatica.
    const config = await negocioExemplo();
    const estavel = montarSystem(config, lead())[0]?.text ?? "";

    assert.match(estavel, /Nao invente elogio ao servico/i);
    assert.match(estavel, /uma das nossas especialidades/i);
  });

  test("depois de marcar, a IA se despede em vez de cortar", async () => {
    const texto = confirmacaoDoAgendamento(
      "Avaliacao",
      DateTime.fromISO("2026-09-21T09:00", { zone: "America/Sao_Paulo" }),
    );

    assert.match(texto, /Agendado com sucesso/i);
    assert.match(texto, /se colocando a disposicao e se despedindo/i);
    assert.match(texto, /e so me chamar/i);
  });
});
