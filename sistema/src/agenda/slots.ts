import { DateTime } from "luxon";
import type { Negocio } from "../config/negocio.js";
import { db } from "../lib/db.js";
import { agora } from "../lib/horario.js";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

export interface Ocupado {
  inicio: DateTime;
  fim: DateTime;
}

async function carregarOcupados(
  negocio: Negocio,
  de: DateTime,
  ate: DateTime,
  ignorarId?: string,
): Promise<Ocupado[]> {
  const agendamentos = await db.appointment.findMany({
    where: {
      scheduledAt: { gte: de.toJSDate(), lte: ate.toJSDate() },
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      // Ao remarcar, o proprio compromisso nao pode contar como conflito consigo mesmo.
      ...(ignorarId ? { id: { not: ignorarId } } : {}),
    },
    select: { scheduledAt: true, durationMin: true },
  });

  return agendamentos.map((a) => {
    const inicio = DateTime.fromJSDate(a.scheduledAt).setZone(negocio.horarios.timezone);
    return { inicio, fim: inicio.plus({ minutes: a.durationMin }) };
  });
}

/**
 * Bloqueios sao diferentes de agendamentos: nao ocupam "uma vaga", eles fecham
 * o periodo inteiro. Feriado com 3 cadeiras livres continua sendo feriado.
 */
async function carregarBloqueios(
  negocio: Negocio,
  de: DateTime,
  ate: DateTime,
): Promise<Ocupado[]> {
  const bloqueios = await db.scheduleBlock.findMany({
    where: { endsAt: { gte: de.toJSDate() }, startsAt: { lte: ate.toJSDate() } },
    select: { startsAt: true, endsAt: true },
  });

  return bloqueios.map((b) => ({
    inicio: DateTime.fromJSDate(b.startsAt).setZone(negocio.horarios.timezone),
    fim: DateTime.fromJSDate(b.endsAt).setZone(negocio.horarios.timezone),
  }));
}

function conflitos(ocupados: Ocupado[], inicio: DateTime, fim: DateTime): number {
  return ocupados.filter((o) => o.inicio < fim && inicio < o.fim).length;
}

const bloqueado = (bloqueios: Ocupado[], inicio: DateTime, fim: DateTime): boolean =>
  conflitos(bloqueios, inicio, fim) > 0;

/**
 * Horarios livres, respeitando funcionamento, antecedencia minima e quantos
 * atendimentos cabem ao mesmo tempo.
 */
export async function horariosDisponiveis(
  negocio: Negocio,
  opcoes: {
    duracaoMin?: number;
    diaEspecifico?: string;
    limite?: number;
    /** Injetaveis para teste sem banco. Em producao vem do banco. */
    ocupados?: Ocupado[];
    bloqueios?: Ocupado[];
    /** Ao remarcar, ignora o proprio compromisso na hora de contar conflitos. */
    ignorarAgendamentoId?: string;
    /** false = quem marca e a equipe no CRM (ver regrasDaIaValem). */
    regrasDaIa?: boolean;
  } = {},
): Promise<DateTime[]> {
  const cfg = negocio.agenda;
  if (!cfg.ativo) return [];

  const duracao = opcoes.duracaoMin ?? cfg.duracaoPadraoMin;
  const limite = opcoes.limite ?? 12;
  const zona = negocio.horarios.timezone;

  const daIa = opcoes.regrasDaIa ?? true;
  const inicioBusca = daIa ? agora(negocio).plus({ hours: cfg.antecedenciaMinimaHoras }) : agora(negocio);
  const fimBusca =
    !daIa && opcoes.diaEspecifico
      ? DateTime.fromISO(opcoes.diaEspecifico, { zone: negocio.horarios.timezone }).endOf("day")
      : agora(negocio).plus({ days: cfg.janelaDias }).endOf("day");

  const ocupados =
    opcoes.ocupados ??
    (await carregarOcupados(negocio, inicioBusca, fimBusca, opcoes.ignorarAgendamentoId));
  const bloqueios = opcoes.bloqueios ?? (await carregarBloqueios(negocio, inicioBusca, fimBusca));
  const livres: DateTime[] = [];

  let dia = opcoes.diaEspecifico
    ? DateTime.fromISO(opcoes.diaEspecifico, { zone: zona }).startOf("day")
    : inicioBusca.startOf("day");

  const ultimoDia = opcoes.diaEspecifico ? dia.endOf("day") : fimBusca;

  while (dia <= ultimoDia && livres.length < limite) {
    const chave = DIAS[dia.weekday % 7] as (typeof DIAS)[number];
    const intervalos = negocio.horarios.atendimento[chave] ?? [];

    for (const [abre, fecha] of intervalos) {
      const [hA, mA] = abre.split(":");
      const [hF, mF] = fecha.split(":");
      let cursor = dia.set({ hour: Number(hA ?? 0), minute: Number(mA ?? 0), second: 0, millisecond: 0 });
      const limiteDoDia = dia.set({ hour: Number(hF ?? 0), minute: Number(mF ?? 0), second: 0, millisecond: 0 });

      while (cursor.plus({ minutes: duracao }) <= limiteDoDia) {
        const fim = cursor.plus({ minutes: duracao });
        const disponivel =
          cursor >= inicioBusca &&
          !bloqueado(bloqueios, cursor, fim) &&
          conflitos(ocupados, cursor, fim) < cfg.atendimentosSimultaneos;

        if (disponivel) {
          livres.push(cursor);
          if (livres.length >= limite) break;
        }
        cursor = cursor.plus({ minutes: cfg.intervaloSlotsMin });
      }
      if (livres.length >= limite) break;
    }
    dia = dia.plus({ days: 1 });
  }

  return livres;
}

/** Confere se um horario especifico ainda pode ser marcado. */
export async function horarioEhValido(
  negocio: Negocio,
  quando: DateTime,
  duracaoMin: number,
  opcoes: {
    ocupados?: Ocupado[];
    bloqueios?: Ocupado[];
    ignorarAgendamentoId?: string;
    regrasDaIa?: boolean;
  } = {},
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const cfg = negocio.agenda;
  const daIa = opcoes.regrasDaIa ?? true;

  // Antecedencia e janela sao regras de quem marca pelo WhatsApp. A recepcao
  // encaixando o paciente que esta no balcao, ou marcando o retorno de daqui a
  // 90 dias, nao pode ser barrada por elas. O passado tambem so e proibido para a
  // IA (decisao do dono, 26/09/2026): a equipe registra no CRM um atendimento que
  // aconteceu e nao estava anotado em lugar nenhum. Nenhuma mensagem sai por isso,
  // e o lembrete de um horario que ja passou nao e criado (agendarLembrete).
  if (daIa && quando < agora(negocio).plus({ hours: cfg.antecedenciaMinimaHoras })) {
    return {
      ok: false,
      motivo: `esse horario e muito em cima. O mais cedo possivel e daqui a ${cfg.antecedenciaMinimaHoras}h.`,
    };
  }
  if (daIa && quando > agora(negocio).plus({ days: cfg.janelaDias })) {
    return { ok: false, motivo: `a agenda so esta aberta pelos proximos ${cfg.janelaDias} dias.` };
  }

  const chave = DIAS[quando.weekday % 7] as (typeof DIAS)[number];
  const intervalos = negocio.horarios.atendimento[chave] ?? [];
  const minutos = quando.hour * 60 + quando.minute;
  const fimMinutos = minutos + duracaoMin;

  const dentro = intervalos.some(([abre, fecha]) => {
    const [hA, mA] = abre.split(":");
    const [hF, mF] = fecha.split(":");
    return (
      minutos >= Number(hA ?? 0) * 60 + Number(mA ?? 0) &&
      fimMinutos <= Number(hF ?? 0) * 60 + Number(mF ?? 0)
    );
  });

  // Funcionamento e bloqueio tambem sao regras da IA (decisao do dono, 26/09/2026):
  // a equipe no CRM usa a agenda como uma agenda normal e pode marcar um cliente
  // especifico num domingo, depois do expediente ou num dia bloqueado. Horario
  // ocupado continua valendo para todos: senao o dono marca em cima do que a IA vendeu.
  if (daIa && !dentro) return { ok: false, motivo: "esse horario esta fora do funcionamento." };

  const fim = quando.plus({ minutes: duracaoMin });

  if (daIa) {
    const bloqueios =
      opcoes.bloqueios ??
      (await carregarBloqueios(negocio, quando.startOf("day"), quando.endOf("day")));
    if (bloqueado(bloqueios, quando, fim)) {
      return { ok: false, motivo: "a agenda esta fechada nesse periodo." };
    }
  }

  const ocupados =
    opcoes.ocupados ??
    (await carregarOcupados(
      negocio,
      quando.startOf("day"),
      quando.endOf("day"),
      opcoes.ignorarAgendamentoId,
    ));
  if (conflitos(ocupados, quando, fim) >= cfg.atendimentosSimultaneos) {
    return { ok: false, motivo: "esse horario acabou de ser ocupado." };
  }

  return { ok: true };
}

/** "quinta-feira, 11/09 as 14:00" — formato que a IA repassa pro cliente. */
export function formatarSlot(slot: DateTime): string {
  return slot.setLocale("pt-BR").toFormat("cccc, dd/LL 'as' HH:mm");
}
