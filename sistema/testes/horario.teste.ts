import "./preparar.js";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { describe, test } from "node:test";
import { dentroDoHorario, horarioPorExtenso, proximaAbertura } from "../src/lib/horario.js";
import { horariosDisponiveis, horarioEhValido } from "../src/agenda/slots.js";
import { ofertaDeHorarios } from "../src/agente/ferramentas.js";
import { negocioExemplo } from "./fixtures.js";

const emSP = (iso: string) => DateTime.fromISO(iso, { zone: "America/Sao_Paulo" });

/** Quebra de linha por codigo: escrita a mao, a barra invertida ja se perdeu aqui uma vez. */
const QUEBRA = String.fromCharCode(10);

describe("horario de funcionamento", () => {
  test("reconhece aberto e fechado", async () => {
    const { negocio } = await negocioExemplo();

    // 2026-09-10 e uma quinta-feira. Expediente: 09:00 as 19:00.
    assert.equal(dentroDoHorario(negocio, emSP("2026-09-10T14:00")), true);
    assert.equal(dentroDoHorario(negocio, emSP("2026-09-10T08:59")), false);
    assert.equal(dentroDoHorario(negocio, emSP("2026-09-10T19:00")), false, "19:00 ja e o fim");

    // Sabado ate 13:00, domingo fechado.
    assert.equal(dentroDoHorario(negocio, emSP("2026-09-12T11:00")), true);
    assert.equal(dentroDoHorario(negocio, emSP("2026-09-12T14:00")), false);
    assert.equal(dentroDoHorario(negocio, emSP("2026-09-13T11:00")), false);
  });

  test("proxima abertura pula o domingo", async () => {
    const { negocio } = await negocioExemplo();
    const proxima = proximaAbertura(negocio, emSP("2026-09-13T10:00")); // domingo
    assert.ok(proxima);
    assert.equal(proxima.toFormat("yyyy-LL-dd HH:mm"), "2026-09-14 09:00");
  });

  test("horario por extenso lista os sete dias", async () => {
    const { negocio } = await negocioExemplo();
    const texto = horarioPorExtenso(negocio);
    assert.ok(texto.includes("domingo: fechado"));
    assert.ok(texto.includes("09:00 as 19:00"));
  });
});

describe("agenda", () => {
  test("so oferece horario dentro do expediente e respeitando a antecedencia", async () => {
    const { negocio } = await negocioExemplo();
    const slots = await horariosDisponiveis(negocio, { ocupados: [], bloqueios: [], limite: 20 });

    assert.ok(slots.length > 0, "deveria haver horario livre na agenda vazia");

    const minimo = DateTime.now()
      .setZone(negocio.horarios.timezone)
      .plus({ hours: negocio.agenda.antecedenciaMinimaHoras });

    for (const slot of slots) {
      assert.ok(slot >= minimo, `slot ${slot.toISO()} viola a antecedencia minima`);
      assert.ok(
        dentroDoHorario(negocio, slot),
        `slot ${slot.toISO()} caiu fora do horario de funcionamento`,
      );
    }
  });

  test("nao oferece horario ja ocupado", async () => {
    const { negocio } = await negocioExemplo();

    const livres = await horariosDisponiveis(negocio, { ocupados: [], bloqueios: [], limite: 3 });
    const alvo = livres[0];
    assert.ok(alvo);

    const comOcupado = await horariosDisponiveis(negocio, {
      ocupados: [{ inicio: alvo, fim: alvo.plus({ minutes: negocio.agenda.duracaoPadraoMin }) }],
      bloqueios: [],
      limite: 3,
    });

    assert.ok(
      !comOcupado.some((s) => s.toMillis() === alvo.toMillis()),
      "ofereceu um horario que ja estava ocupado - marcaria duas pessoas no mesmo slot",
    );
  });

  test("recusa horario em cima da hora, fora do expediente e no passado", async () => {
    const { negocio } = await negocioExemplo();
    const duracao = negocio.agenda.duracaoPadraoMin;

    const emCima = await horarioEhValido(negocio, DateTime.now().plus({ minutes: 30 }), duracao, { ocupados: [], bloqueios: [] });
    assert.equal(emCima.ok, false);

    const madrugada = await horarioEhValido(
      negocio,
      DateTime.now().setZone("America/Sao_Paulo").plus({ days: 3 }).set({ hour: 3, minute: 0 }),
      duracao,
      { ocupados: [], bloqueios: [] },
    );
    assert.equal(madrugada.ok, false);

    const passado = await horarioEhValido(negocio, DateTime.now().minus({ days: 1 }), duracao, { ocupados: [], bloqueios: [] });
    assert.equal(passado.ok, false);
  });

  test("antecedencia e janela sao regras da IA; a equipe encaixa e marca retorno longe", async () => {
    const { negocio } = await negocioExemplo();
    const duracao = negocio.agenda.duracaoPadraoMin;
    const vazio = { ocupados: [], bloqueios: [] };

    // Uma terca daqui a uns 60 dias, 10:00: fora da janela da IA, dentro do expediente.
    let longe = DateTime.now().setZone("America/Sao_Paulo").plus({ days: 60 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
    while (longe.weekday !== 2) longe = longe.plus({ days: 1 });

    assert.equal((await horarioEhValido(negocio, longe, duracao, vazio)).ok, false, "a IA nao marca fora da janela");
    assert.equal(
      (await horarioEhValido(negocio, longe, duracao, { ...vazio, regrasDaIa: false })).ok,
      true,
      "a equipe marca o retorno de daqui a 2 meses",
    );

    // Passado: a IA nunca; a equipe registra o atendimento que ja aconteceu.
    const ontem = DateTime.now().setZone("America/Sao_Paulo").minus({ days: 1 });
    assert.equal((await horarioEhValido(negocio, ontem, duracao, vazio)).ok, false, "a IA nao marca no passado");
    assert.equal(
      (await horarioEhValido(negocio, ontem, duracao, { ...vazio, regrasDaIa: false })).ok,
      true,
      "a equipe registra um atendimento que ja aconteceu",
    );

    // Funcionamento e bloqueio tambem: a equipe marca num domingo ou num dia bloqueado.
    let domingo = DateTime.now().setZone("America/Sao_Paulo").plus({ days: 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
    while (domingo.weekday !== 7) domingo = domingo.plus({ days: 1 });
    assert.equal((await horarioEhValido(negocio, domingo, duracao, vazio)).ok, false, "a IA nao marca no domingo");
    assert.equal(
      (await horarioEhValido(negocio, domingo, duracao, { ...vazio, regrasDaIa: false })).ok,
      true,
      "a equipe marca no domingo",
    );
    const feriado = [{ inicio: longe.startOf("day"), fim: longe.endOf("day") }];
    assert.equal((await horarioEhValido(negocio, longe, duracao, { ocupados: [], bloqueios: feriado, regrasDaIa: false })).ok, true, "a equipe marca num dia bloqueado");
    const cheio = [{ inicio: longe, fim: longe.plus({ minutes: duracao }) }];
    const comFolga = { ...negocio, agenda: { ...negocio.agenda, atendimentosSimultaneos: 1 } };
    assert.equal((await horarioEhValido(comFolga, longe, duracao, { ocupados: cheio, bloqueios: [], regrasDaIa: false })).ok, false, "horario ocupado vale para todos");

    const lista = await horariosDisponiveis(negocio, { ...vazio, diaEspecifico: longe.toISODate()!, regrasDaIa: false });
    assert.ok(lista.length > 0, "a tela do CRM lista horarios num dia alem da janela");
  });

  test("aceita um horario que veio de consultar_horarios", async () => {
    const { negocio } = await negocioExemplo();
    const livres = await horariosDisponiveis(negocio, { ocupados: [], bloqueios: [], limite: 1 });
    const alvo = livres[0];
    assert.ok(alvo);

    const resultado = await horarioEhValido(negocio, alvo, negocio.agenda.duracaoPadraoMin, { ocupados: [], bloqueios: [] });
    assert.equal(
      resultado.ok,
      true,
      "um horario oferecido pela propria ferramenta precisa ser aceito no agendamento",
    );
  });
});

describe("bloqueios de agenda", () => {
  test("dia bloqueado nao aparece nos horarios livres", async () => {
    const { negocio } = await negocioExemplo();

    const livres = await horariosDisponiveis(negocio, {
      ocupados: [],
      bloqueios: [],
      limite: 5,
    });
    const alvo = livres[0];
    assert.ok(alvo);

    // Bloqueia o dia inteiro em que caiu o primeiro horario livre.
    const comBloqueio = await horariosDisponiveis(negocio, {
      ocupados: [],
      bloqueios: [{ inicio: alvo.startOf("day"), fim: alvo.endOf("day") }],
      limite: 20,
    });

    assert.ok(
      !comBloqueio.some((s) => s.hasSame(alvo, "day")),
      "ofereceu horario num dia bloqueado — a IA marcaria consulta no feriado",
    );
  });

  test("bloqueio fecha o periodo mesmo com vagas sobrando", async () => {
    const { negocio } = await negocioExemplo();
    // Tres atendimentos simultaneos: sem bloqueio caberia gente de sobra.
    const comFolga = { ...negocio, agenda: { ...negocio.agenda, atendimentosSimultaneos: 3 } };

    const livres = await horariosDisponiveis(comFolga, {
      ocupados: [],
      bloqueios: [],
      limite: 3,
    });
    const alvo = livres[0];
    assert.ok(alvo);

    const resultado = await horarioEhValido(comFolga, alvo, comFolga.agenda.duracaoPadraoMin, {
      ocupados: [],
      bloqueios: [{ inicio: alvo.minus({ hours: 1 }), fim: alvo.plus({ hours: 1 }) }],
    });

    assert.equal(resultado.ok, false, "bloqueio nao e uma vaga ocupada: ele fecha o periodo");
    if (!resultado.ok) assert.match(resultado.motivo, /fechada/);
  });

  test("bloqueio que termina antes nao atrapalha", async () => {
    const { negocio } = await negocioExemplo();

    const livres = await horariosDisponiveis(negocio, { ocupados: [], bloqueios: [], limite: 1 });
    const alvo = livres[0];
    assert.ok(alvo);

    const resultado = await horarioEhValido(negocio, alvo, negocio.agenda.duracaoPadraoMin, {
      ocupados: [],
      bloqueios: [{ inicio: alvo.minus({ hours: 3 }), fim: alvo.minus({ hours: 2 }) }],
    });

    assert.equal(resultado.ok, true);
  });
});

describe("o que a IA recebe ao consultar a agenda", () => {
  // 21/09/2026 e uma segunda-feira. A grade da clinica comeca as 09:00.
  const segunda = [
    "09:00",
    "09:40",
    "10:20",
    "11:00",
    "11:40",
    "14:00",
    "14:40",
    "15:20",
  ].map((h) => emSP(`2026-09-21T${h}`));

  test("sempre oferece os mesmos tres, na ordem", () => {
    // O defeito do teste real: a cada consulta o modelo escolhia outros tres da lista,
    // e o horario que a pessoa tinha acabado de aceitar sumia da oferta seguinte.
    const primeira = ofertaDeHorarios(segunda, {});
    const segundaVez = ofertaDeHorarios(segunda, {});

    assert.equal(primeira, segundaVez, "duas consultas iguais tem que oferecer o mesmo");
    assert.ok(primeira.includes("2026-09-21T09:00"));
    assert.ok(primeira.includes("2026-09-21T09:40"));
    assert.ok(primeira.includes("2026-09-21T10:20"));
    assert.ok(!primeira.includes("2026-09-21T11:00"), "so tres cabem numa mensagem");
  });

  test("diz o dia uma vez, nao um por horario", () => {
    // No teste real saiu "Segunda-feira, 21/09 as 09:00" tres vezes, uma por linha,
    // virando lista com hifen no WhatsApp. A lista com hifen vinha daqui.
    const texto = ofertaDeHorarios(segunda, {});
    const linhas = texto.split(QUEBRA).filter((l) => l.includes("2026-09-21T"));

    assert.equal(linhas.length, 1, "os tres horarios do mesmo dia cabem numa linha");
    assert.ok(!texto.includes("- segunda"), "nada de lista com hifen");
    assert.match(texto, /Nada de lista/i);
    assert.match(texto, /as 09:00, 09:40 ou 10:20/i, "a frase pronta tem que soar como gente");
  });

  test("dias diferentes ficam em linhas diferentes", () => {
    const doisDias = [emSP("2026-09-21T09:00"), emSP("2026-09-22T09:00")];
    const linhas = ofertaDeHorarios(doisDias, {})
      .split(QUEBRA)
      .filter((l) => l.includes("T09:00"));

    assert.equal(linhas.length, 2);
  });

  test("o periodo e filtrado aqui, nao pelo modelo", () => {
    const tarde = ofertaDeHorarios(segunda, { periodo: "tarde" });

    assert.ok(tarde.includes("2026-09-21T14:00"));
    assert.ok(!tarde.includes("2026-09-21T09:00"), "manha nao pode entrar na oferta da tarde");
  });

  test("manda agendar direto, sem segunda confirmacao nem nova consulta", () => {
    const texto = ofertaDeHorarios(segunda, {});

    assert.match(texto, /chame agendar/i);
    assert.match(texto, /nao consulte a agenda outra vez/i);
  });

  test("periodo sem vaga manda oferecer outro, nao inventar", () => {
    const soDeManha = segunda.filter((s) => s.hour < 12);
    const texto = ofertaDeHorarios(soDeManha, { periodo: "tarde" });

    assert.match(texto, /Nao ha horario livre/i);
    assert.match(texto, /consulte de novo/i);
  });

  test("diz quando acabaram os horarios, para a IA nao prometer mais", () => {
    const texto = ofertaDeHorarios(segunda.slice(0, 2), {});
    assert.match(texto, /Nao ha outro horario livre alem destes/i);
  });
});
