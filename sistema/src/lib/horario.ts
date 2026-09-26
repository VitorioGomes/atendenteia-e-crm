import { DateTime } from "luxon";
import type { Negocio } from "../config/negocio.js";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
type DiaChave = (typeof DIAS)[number];

const NOME_DIA: Record<DiaChave, string> = {
  dom: "domingo",
  seg: "segunda-feira",
  ter: "terca-feira",
  qua: "quarta-feira",
  qui: "quinta-feira",
  sex: "sexta-feira",
  sab: "sabado",
};

function diaChave(dt: DateTime): DiaChave {
  // luxon: weekday 1 = segunda ... 7 = domingo
  return DIAS[dt.weekday % 7] as DiaChave;
}

export function agora(negocio: Negocio): DateTime {
  return DateTime.now().setZone(negocio.horarios.timezone);
}

export function dentroDoHorario(negocio: Negocio, quando: DateTime = agora(negocio)): boolean {
  const intervalos = negocio.horarios.atendimento[diaChave(quando)] ?? [];
  const minutos = quando.hour * 60 + quando.minute;

  return intervalos.some(([inicio, fim]) => {
    return minutos >= paraMinutos(inicio) && minutos < paraMinutos(fim);
  });
}

function paraMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h ?? 0) * 60 + Number(m ?? 0);
}

/** Texto pronto pro prompt: "sexta-feira, 04/09/2026, 14:32". */
export function agoraPorExtenso(negocio: Negocio): string {
  const dt = agora(negocio);
  return `${NOME_DIA[diaChave(dt)]}, ${dt.toFormat("dd/LL/yyyy")}, ${dt.toFormat("HH:mm")}`;
}

/**
 * Os proximos dias ja com a data no formato que as ferramentas pedem.
 *
 * O prompt dizia "terca-feira, 22/09/2026" e a ferramenta pede AAAA-MM-DD. Para achar
 * "sabado" o modelo tinha que converter o formato, contar dias e lembrar o ano, e no
 * teste de 22/09/2026 errou o ano: consultou 2025-09-27, a data ja tinha passado, a
 * agenda voltou vazia e ele disse ao cliente que o sabado estava lotado. Com a data
 * pronta ao lado do nome do dia, nao sobra conta nenhuma para ele fazer.
 */
export function proximosDias(negocio: Negocio, quantos = 8, desde: DateTime = agora(negocio)): string {
  const hoje = desde.startOf("day");
  return Array.from({ length: quantos }, (_, i) => {
    const dia = hoje.plus({ days: i });
    const fechado = (negocio.horarios.atendimento[diaChave(dia)] ?? []).length === 0;
    const marcas = [i === 0 ? "hoje" : i === 1 ? "amanha" : "", fechado ? "fechado" : ""]
      .filter(Boolean)
      .join(", ");
    return `- ${NOME_DIA[diaChave(dia)]} ${dia.toFormat("yyyy-LL-dd")}${marcas ? ` (${marcas})` : ""}`;
  }).join("\n");
}

/**
 * Confere uma data que o modelo mandou para a agenda. Devolve o que dizer a ele
 * quando ela nao serve, ou null quando serve.
 *
 * "Nao ha horario livre" era a resposta para tudo: data no passado, ano errado, dia
 * fechado e dia cheio. O modelo nao tem como distinguir, e traduz as quatro como
 * "lotado" para o cliente. Cada uma precisa de uma resposta que diga o que fazer.
 */
export function conferirDia(
  negocio: Negocio,
  diaIso: string,
  desde: DateTime = agora(negocio),
): string | null {
  const dia = DateTime.fromISO(diaIso, { zone: negocio.horarios.timezone });
  const hoje = desde.startOf("day");
  const hojeIso = `${NOME_DIA[diaChave(hoje)]}, ${hoje.toFormat("yyyy-LL-dd")}`;

  if (!dia.isValid) {
    return `A data "${diaIso}" nao e valida. Use o formato AAAA-MM-DD. Hoje e ${hojeIso}.`;
  }

  if (dia.startOf("day") < hoje) {
    // O caso mais comum e o ano errado: o dia da semana que a pessoa pediu vale,
    // so a data que foi montada errada. Entrega a data certa pronta.
    let proximo = hoje;
    while (proximo.weekday !== dia.weekday) proximo = proximo.plus({ days: 1 });
    return (
      `A data ${diaIso} ja passou: hoje e ${hojeIso}. Confira o ano. ` +
      `Se a pessoa pediu ${NOME_DIA[diaChave(dia)]}, a proxima e ${proximo.toFormat("yyyy-LL-dd")}. ` +
      "Consulte de novo com a data certa antes de responder a ela."
    );
  }

  if ((negocio.horarios.atendimento[diaChave(dia)] ?? []).length === 0) {
    return (
      `${NOME_DIA[diaChave(dia)]} (${diaIso}) o negocio nao abre. Isso nao e agenda lotada: ` +
      "diga que nesse dia nao ha atendimento e ofereca outro dia."
    );
  }

  return null;
}

/** Horario de funcionamento em uma linha, pra IA poder informar quando perguntarem. */
export function horarioPorExtenso(negocio: Negocio): string {
  const linhas: string[] = [];
  for (const dia of ["seg", "ter", "qua", "qui", "sex", "sab", "dom"] as const) {
    const intervalos = negocio.horarios.atendimento[dia] ?? [];
    const texto =
      intervalos.length === 0
        ? "fechado"
        : intervalos.map(([i, f]) => `${i} as ${f}`).join(" e ");
    linhas.push(`${NOME_DIA[dia]}: ${texto}`);
  }
  return linhas.join("\n");
}

/** Proxima abertura, para a mensagem de fora de horario. */
export function proximaAbertura(
  negocio: Negocio,
  apartirDe: DateTime = agora(negocio),
): DateTime | null {
  let cursor = apartirDe;
  for (let i = 0; i < 14; i++) {
    const intervalos = negocio.horarios.atendimento[diaChave(cursor)] ?? [];
    for (const [inicio] of intervalos) {
      const [h, m] = inicio.split(":");
      const candidato = cursor.set({
        hour: Number(h ?? 0),
        minute: Number(m ?? 0),
        second: 0,
        millisecond: 0,
      });
      if (candidato > apartirDe) return candidato;
    }
    cursor = cursor.plus({ days: 1 }).startOf("day");
  }
  return null;
}
