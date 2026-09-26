import "./preparar.js";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { describe, test } from "node:test";
import { textoParaEnviar } from "../src/agente/cerebro.js";
import { definirFerramentas, pareceEmail } from "../src/agente/ferramentas.js";
import { conferirDia, proximosDias } from "../src/lib/horario.js";
import { ehNumeroDoAviso, numeroDoAviso, textoDoAviso } from "../src/atendimento/aviso-equipe.js";
import { negocioExemplo } from "./fixtures.js";

/**
 * Defeitos achados no segundo teste real da skill (pet shop, 22/09/2026). Cada um
 * tinha causa mecanica, e por isso tem teste: regra no prompt nao segurou nenhum.
 */

// Terca-feira, 22/09/2026, 13:58, em Sao Paulo: o momento exato da conversa do teste.
const NO_TESTE = DateTime.fromISO("2026-09-22T13:58", { zone: "America/Sao_Paulo" });

describe("a IA errou o ano e disse que o sabado estava lotado", () => {
  test("data de ano errado nao volta como 'sem horario': volta com a data certa", async () => {
    const { negocio } = await negocioExemplo();
    const aviso = conferirDia(negocio, "2025-09-27", NO_TESTE);

    assert.ok(aviso, "data no passado precisa ser barrada antes de chegar na agenda");
    assert.match(aviso!, /ja passou/i);
    assert.match(aviso!, /Confira o ano/i);
    // 27/09/2025 foi um sabado; o proximo sabado depois de 22/09/2026 e 26/09/2026.
    assert.match(aviso!, /2026-09-26/, "a data certa tem que vir pronta para ela usar");
    assert.doesNotMatch(aviso!, /lotad/i);
  });

  test("dia fechado nao e agenda lotada", async () => {
    const { negocio } = await negocioExemplo();
    // No exemplo da clinica, domingo e fechado. 27/09/2026 e um domingo.
    const aviso = conferirDia(negocio, "2026-09-27", NO_TESTE);

    assert.ok(aviso);
    assert.match(aviso!, /nao abre/i);
    assert.match(aviso!, /nao e agenda lotada/i);
  });

  test("data valida passa direto", async () => {
    const { negocio } = await negocioExemplo();
    assert.equal(conferirDia(negocio, "2026-09-24", NO_TESTE), null);
  });

  test("data que nao e data vira instrucao de formato", async () => {
    const { negocio } = await negocioExemplo();
    assert.match(conferirDia(negocio, "sabado", NO_TESTE) ?? "", /AAAA-MM-DD/);
  });

  test("o prompt ja entrega os proximos dias com a data pronta e o ano certo", async () => {
    const { negocio } = await negocioExemplo();
    const dias = proximosDias(negocio, 8, NO_TESTE);

    assert.match(dias, /terca-feira 2026-09-22 \(hoje\)/);
    assert.match(dias, /sabado 2026-09-26/);
    assert.match(dias, /domingo 2026-09-27 \(fechado\)/, "dia fechado vem marcado");
    assert.doesNotMatch(dias, /2025/);
  });
});

describe("a tosa de 2 horas foi marcada com 1 hora", () => {
  test("o servico vira lista fechada nas ferramentas de agenda", async () => {
    // Livre, a IA escreveu "Tosa completa" e a configuracao dizia "Tosa completa
    // (cachorro)": a busca falhou e a tosa ficou com a duracao padrao.
    const config = await negocioExemplo();
    const enumDe = (c: typeof config, nome: string) =>
      ((definirFerramentas(c).find((x) => x.name === nome)?.input_schema.properties as any)?.servico
        ?.enum as string[] | undefined);

    // A clinica de exemplo marca so a Avaliacao como "agendavel": e so ela que a IA marca.
    const agendaveis = config.negocio.servicos.filter((s) => s.agendavel).map((s) => s.nome);
    assert.ok(agendaveis.length > 0 && agendaveis.length < config.negocio.servicos.length);
    for (const nome of ["consultar_horarios", "agendar"]) {
      assert.deepEqual(enumDe(config, nome), agendaveis, `${nome} so aceita o que e agendavel`);
    }

    // Negocio que nao marcou nenhum (os gerados pela skill): todos os servicos cadastrados.
    const semMarca = {
      ...config,
      negocio: {
        ...config.negocio,
        servicos: config.negocio.servicos.map((s) => ({ ...s, agendavel: false })),
      },
    };
    const todos = config.negocio.servicos.map((s) => s.nome);
    for (const nome of ["consultar_horarios", "agendar"]) {
      assert.deepEqual(enumDe(semMarca, nome), todos, `${nome} aceita todos quando nenhum foi marcado`);
    }
  });
});

describe("a IA narrou o que estava fazendo", () => {
  test("texto escrito junto com a consulta da agenda nao sai", () => {
    const texto = textoParaEnviar([
      { textos: ["Deixa eu ver se temos esse horario disponivel."], ferramentas: ["consultar_horarios"] },
      { textos: ["Tenho quinta, 24/09, as 08:00, 09:00 ou 10:00."], ferramentas: [] },
    ]);

    assert.ok(!texto.includes("Deixa eu ver"), "a narracao foi para o cliente");
    assert.ok(texto.includes("quinta"));
  });

  test("palpite antes de marcar nao sai quando a IA responde depois", () => {
    // Escrito antes do resultado, "pronto, marquei" seria mentira se o agendar falhasse.
    const texto = textoParaEnviar([
      { textos: ["Pronto, marquei!"], ferramentas: ["agendar"] },
      { textos: ["Esse horario acabou de ser ocupado. Tenho 09:00 ou 10:00."], ferramentas: [] },
    ]);

    assert.ok(!texto.includes("Pronto, marquei"));
  });

  test("resposta escrita junto com ferramenta de registro sai normalmente", () => {
    // Anotar o lead nao muda o que se diz ao cliente: ali a resposta ja esta pronta.
    const texto = textoParaEnviar([
      { textos: ["Labrador e grande! O banho sai por R$ 90."], ferramentas: ["atualizar_lead"] },
      { textos: [], ferramentas: [] },
    ]);

    assert.equal(texto, "Labrador e grande! O banho sai por R$ 90.");
  });

  test("se a IA nao disser mais nada, nunca manda resposta vazia", () => {
    const texto = textoParaEnviar([
      { textos: ["Pronto, marquei para quinta as 8h!"], ferramentas: ["agendar"] },
      { textos: [], ferramentas: [] },
    ]);

    assert.equal(texto, "Pronto, marquei para quinta as 8h!");
  });
});

describe("a IA gravou o telefone no campo de e-mail", () => {
  test("so passa o que tem cara de e-mail", () => {
    assert.equal(pareceEmail("fulano@gmail.com"), true);
    assert.equal(pareceEmail("551190001234"), false, "telefone nao e e-mail");
    assert.equal(pareceEmail("nao informado"), false);
    assert.equal(pareceEmail("fulano@"), false);
    assert.equal(pareceEmail("fulano@gmail"), false);
    assert.equal(pareceEmail("a b@c.com"), false);
  });
});

describe("a IA chamou a equipe e ninguem ficou sabendo", () => {
  test("o aviso diz quem e o cliente e o motivo", () => {
    const texto = textoDoAviso({
      atendente: "Mel",
      cliente: "João Pereira",
      telefone: "551190001234",
      motivo: "Quer deixar o pet o dia todo.",
    });

    assert.match(texto, /Mel precisa de você/);
    assert.match(texto, /João Pereira, \(11\) 9000-1234/);
    assert.match(texto, /Motivo: Quer deixar o pet o dia todo\./);
    assert.doesNotMatch(texto, /—/, "sem travessao");
  });

  test("sem nome, o aviso usa o telefone", () => {
    const texto = textoDoAviso({ atendente: "Mel", cliente: null, telefone: "5511987654321", motivo: null });
    assert.match(texto, /Cliente: \(11\) 98765-4321/);
    assert.doesNotMatch(texto, /Motivo/);
  });

  test("sem numero configurado, nao ha aviso", () => {
    assert.equal(numeroDoAviso(""), null);
    assert.equal(numeroDoAviso("123"), null);
    assert.equal(numeroDoAviso("(11) 99000-1234"), "5511990001234");
  });

  test("o numero do aviso nunca vira cliente, com ou sem o nono digito", () => {
    // Configurado com o 9, o WhatsApp entrega sem: tem que reconhecer do mesmo jeito.
    assert.equal(ehNumeroDoAviso("551190001234", "(11) 99000-1234"), true);
    assert.equal(ehNumeroDoAviso("5511990001234", "11 99000-1234"), true);
    assert.equal(ehNumeroDoAviso("5511987654321", "(11) 99000-1234"), false);
    assert.equal(ehNumeroDoAviso("551190001234", ""), false, "sem aviso configurado, todo mundo e cliente");
  });

  test("o aviso ao cliente sai uma vez so, nao antes e depois da transferencia", () => {
    const texto = textoParaEnviar([
      { textos: ["Vou confirmar com a equipe sobre isso. Um momentinho!"], ferramentas: ["transferir_humano"] },
      { textos: ["Deixa eu passar para a equipe responder isso com seguranca pra voce."], ferramentas: [] },
    ]);

    assert.ok(!texto.includes("Vou confirmar"));
    assert.ok(texto.includes("Deixa eu passar"));
  });
});
