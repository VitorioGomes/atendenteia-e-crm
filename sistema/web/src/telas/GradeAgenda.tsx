import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErroApi, api } from "../api";
import type { Agendamento, Bloqueio, ChaveDia, HorariosSemana } from "../api";
import { hora } from "../formato";
import { IconeCheck, IconeMais } from "../icones";

/**
 * A agenda desenhada no tempo: dia, semana ou mês.
 *
 * Para quem: o dono ou a recepção, que precisam ver a semana de relance ("onde tem
 * buraco?") e mexer rápido: clicar num horário vazio para marcar, arrastar para
 * remarcar. Toda regra de horário continua no servidor — a grade só desenha e pede;
 * se o horário não pode, quem diz é a mesma validação que a IA usa.
 */

export type Visao = "dia" | "semana" | "mes";

const ALTURA_HORA = 52;
const PASSO_CLIQUE = 30; // clicar num horário vazio arredonda para meia hora
const PASSO_ARRASTE = 15;
const CHAVES: ChaveDia[] = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const NOMES_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// ------------------------------------------------------------------ datas

export const inicioDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const somarDias = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Semana começa na segunda: é como a agenda de consultório é lida. */
export const inicioDaSemana = (d: Date) => somarDias(inicioDoDia(d), -((d.getDay() + 6) % 7));
export const inicioDoMes = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** AAAA-MM-DD no fuso do navegador (toISOString daria o dia de Londres). */
export function diaLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

const paraMinutos = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const paraHHMM = (minutos: number) =>
  `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
const minutosDoDia = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** O período que cada visão busca no servidor. */
export function periodoDaVisao(visao: Visao, referencia: Date): { de: Date; ate: Date } {
  if (visao === "dia") return { de: inicioDoDia(referencia), ate: somarDias(inicioDoDia(referencia), 1) };
  if (visao === "semana") {
    const de = inicioDaSemana(referencia);
    return { de, ate: somarDias(de, 7) };
  }
  const de = inicioDaSemana(inicioDoMes(referencia));
  return { de, ate: somarDias(de, 42) };
}

export function tituloDoPeriodo(visao: Visao, referencia: Date): string {
  if (visao === "dia") {
    return referencia.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  }
  if (visao === "mes") {
    return referencia.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }
  const de = inicioDaSemana(referencia);
  const ate = somarDias(de, 6);
  const mesmoMes = de.getMonth() === ate.getMonth();
  const inicio = de.toLocaleDateString("pt-BR", mesmoMes ? { day: "numeric" } : { day: "numeric", month: "short" });
  const fim = ate.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
  return `${inicio} a ${fim}`;
}

// ------------------------------------------------------------------ grade

interface Props {
  visao: Visao;
  referencia: Date;
  horarios: HorariosSemana;
  /** Muda quando algo foi alterado fora da grade: força recarregar. */
  versao: number;
  aoAbrir: (item: Agendamento) => void;
  /** Sem hora (clique no mes), o formulario escolhe o horario livre mais perto. */
  aoNovo: (dia: string, hora?: string) => void;
  aoRemarcar: (item: Agendamento, dataHora: string) => void;
  aoIrParaDia: (dia: Date) => void;
  aoErro: (mensagem: string) => void;
}

export function GradeAgenda(props: Props) {
  const { visao, referencia, versao, aoErro } = props;
  const [agendamentos, setAgendamentos] = useState<Agendamento[] | null>(null);
  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([]);
  const { de, ate } = useMemo(() => periodoDaVisao(visao, referencia), [visao, referencia]);

  const carregar = useCallback(async () => {
    try {
      const r = await api.agendaPeriodo(de, ate);
      setAgendamentos(r.agendamentos);
      setBloqueios(r.bloqueios);
    } catch (e) {
      aoErro(e instanceof ErroApi ? e.message : "A agenda não carregou. Recarregue a página.");
    }
  }, [de, ate, aoErro]);

  useEffect(() => {
    void carregar();
    const relogio = setInterval(() => void carregar(), 30_000);
    return () => clearInterval(relogio);
  }, [carregar, versao]);

  if (agendamentos === null) return <div className="esqueleto grade-carregando" />;

  return visao === "mes" ? (
    <GradeMes {...props} de={de} agendamentos={agendamentos} />
  ) : (
    <GradeHoras {...props} de={de} agendamentos={agendamentos} bloqueios={bloqueios} />
  );
}

/** Quem se sobrepõe no mesmo horário divide a largura da coluna. */
function emFaixas(itens: Agendamento[]): Map<string, { faixa: number; total: number }> {
  const resultado = new Map<string, { faixa: number; total: number }>();
  const ordenados = [...itens].sort((a, b) => a.quando.localeCompare(b.quando));
  let grupo: { id: string; faixa: number }[] = [];
  let fimDoGrupo = 0;
  let fimPorFaixa: number[] = [];

  const fecharGrupo = () => {
    const total = Math.max(1, fimPorFaixa.length);
    for (const g of grupo) resultado.set(g.id, { faixa: g.faixa, total });
    grupo = [];
    fimPorFaixa = [];
  };

  for (const a of ordenados) {
    const inicio = new Date(a.quando).getTime();
    const fim = inicio + a.duracaoMin * 60_000;
    if (grupo.length && inicio >= fimDoGrupo) fecharGrupo();
    let faixa = fimPorFaixa.findIndex((f) => f <= inicio);
    if (faixa < 0) faixa = fimPorFaixa.length;
    fimPorFaixa[faixa] = fim;
    grupo.push({ id: a.id, faixa });
    fimDoGrupo = Math.max(fimDoGrupo, fim);
  }
  fecharGrupo();
  return resultado;
}

function classeDoStatus(a: Agendamento): string {
  if (a.semDesfecho) return "sem-desfecho";
  if (a.status === "DONE") return "compareceu";
  if (a.status === "NOSHOW") return "faltou";
  if (a.status === "CONFIRMED") return "confirmado";
  return "agendado";
}

function GradeHoras({
  visao,
  de,
  horarios,
  agendamentos,
  bloqueios,
  aoAbrir,
  aoNovo,
  aoRemarcar,
  aoErro,
}: Props & { de: Date; agendamentos: Agendamento[]; bloqueios: Bloqueio[] }) {
  const corpo = useRef<HTMLDivElement>(null);
  const [fantasma, setFantasma] = useState<{ dia: string; minutos: number; duracao: number } | null>(null);
  const arrastado = useRef<Agendamento | null>(null);
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    const relogio = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(relogio);
  }, []);

  // Os sete dias, inclusive o fechado: a equipe marca como numa agenda normal,
  // ate num domingo (decisao do dono, 26/09/2026). Antes o dia fechado e vazio
  // nao ganhava coluna, e nao havia onde clicar.
  const dias = useMemo(
    () => Array.from({ length: visao === "dia" ? 1 : 7 }, (_, i) => somarDias(de, i)),
    [visao, de],
  );
  const diaFechado = (d: Date) => (horarios[CHAVES[d.getDay()]!] ?? []).length === 0;

  // Janela de horas: o funcionamento da semana, esticada para caber o que estiver fora.
  const [inicioMin, fimMin] = useMemo(() => {
    let menor = Infinity;
    let maior = -Infinity;
    for (const faixas of Object.values(horarios)) {
      for (const [a, b] of faixas ?? []) {
        menor = Math.min(menor, paraMinutos(a));
        maior = Math.max(maior, paraMinutos(b));
      }
    }
    for (const a of agendamentos) {
      const m = minutosDoDia(new Date(a.quando));
      menor = Math.min(menor, m);
      maior = Math.max(maior, m + a.duracaoMin);
    }
    if (!Number.isFinite(menor)) [menor, maior] = [8 * 60, 19 * 60];
    return [Math.floor(menor / 60) * 60, Math.min(24 * 60, Math.ceil(maior / 60) * 60)];
  }, [horarios, agendamentos]);

  const horas = Array.from({ length: (fimMin - inicioMin) / 60 }, (_, i) => inicioMin / 60 + i);
  const altura = ((fimMin - inicioMin) / 60) * ALTURA_HORA;
  const px = (minutos: number) => ((minutos - inicioMin) / 60) * ALTURA_HORA;

  // Ao abrir, rola até perto da hora atual (ou do começo do expediente).
  useEffect(() => {
    const alvo = Math.max(inicioMin, minutosDoDia(new Date()) - 90);
    if (corpo.current) corpo.current.scrollTop = px(alvo);
  }, [visao, inicioMin]);

  const minutoNoPonto = (e: React.MouseEvent | React.DragEvent, passo: number) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = Math.max(0, Math.min(altura - 1, e.clientY - rect.top));
    return inicioMin + Math.floor(((y / ALTURA_HORA) * 60) / passo) * passo;
  };

  const faixas = useMemo(() => {
    const porDia = new Map<string, Agendamento[]>();
    for (const a of agendamentos) {
      const chave = diaLocal(new Date(a.quando));
      porDia.set(chave, [...(porDia.get(chave) ?? []), a]);
    }
    return { porDia, lanes: emFaixas(agendamentos) };
  }, [agendamentos]);

  // O passado tambem recebe clique e card arrastado (26/09/2026): a equipe registra
  // um atendimento que aconteceu e nao estava anotado. So a IA fica presa ao futuro.
  const hoje = diaLocal(agora);

  return (
    <div className={`grade grade-${visao}`} style={{ "--colunas": dias.length } as React.CSSProperties}>
      <div className="grade-topo">
        <div className="grade-canto" />
        {dias.map((d) => (
          <div
            key={diaLocal(d)}
            className={`grade-dia-nome${diaLocal(d) === hoje ? " hoje" : ""}${diaFechado(d) ? " fechado" : ""}`}
            title={diaFechado(d) ? "Dia em que o negócio não abre. A IA não marca aqui; você pode marcar." : undefined}
          >
            <span>{NOMES_CURTOS[d.getDay()]}</span>
            <strong>{d.getDate()}</strong>
          </div>
        ))}
      </div>

      <div className="grade-corpo" ref={corpo}>
        <div className="grade-horas" style={{ height: altura }}>
          {horas.map((h) => (
            <span key={h} style={{ top: px(h * 60) }}>
              {String(h).padStart(2, "0")}:00
            </span>
          ))}
        </div>

        {dias.map((d) => {
          const chave = diaLocal(d);
          const inicioDoDiaMs = d.getTime();
          const blocosDoDia = bloqueios
            .map((b) => {
              const ini = Math.max(new Date(b.inicio).getTime(), inicioDoDiaMs);
              const fim = Math.min(new Date(b.fim).getTime(), inicioDoDiaMs + 86_400_000);
              if (fim <= ini) return null;
              return {
                id: b.id,
                motivo: b.motivo,
                de: Math.max(inicioMin, (ini - inicioDoDiaMs) / 60_000),
                ate: Math.min(fimMin, (fim - inicioDoDiaMs) / 60_000),
              };
            })
            .filter((b): b is NonNullable<typeof b> => b !== null && b.ate > b.de);

          return (
            <div
              key={chave}
              className={`grade-coluna${chave === hoje ? " hoje" : ""}`}
              style={{ height: altura }}
              title="Clique num horário vazio para marcar"
              onClick={(e) => {
                if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.fundo) return;
                const minutos = minutoNoPonto(e, PASSO_CLIQUE);
                aoNovo(chave, paraHHMM(minutos));
              }}
              onDragOver={(e) => {
                if (!arrastado.current) return;
                e.preventDefault();
                const minutos = minutoNoPonto(e, PASSO_ARRASTE);
                if (fantasma?.dia !== chave || fantasma.minutos !== minutos) {
                  setFantasma({ dia: chave, minutos, duracao: arrastado.current.duracaoMin });
                }
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setFantasma(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const item = arrastado.current;
                arrastado.current = null;
                setFantasma(null);
                if (!item) return;
                const minutos = minutoNoPonto(e, PASSO_ARRASTE);
                const destino = `${chave}T${paraHHMM(minutos)}`;
                const atual = new Date(item.quando);
                if (diaLocal(atual) === chave && minutosDoDia(atual) === minutos) return;
                aoRemarcar(item, destino);
              }}
            >
              {horas.map((h) => (
                <div key={h} className="grade-linha" data-fundo="1" style={{ top: px(h * 60) }} />
              ))}
              {blocosDoDia.map((b) => (
                <div
                  key={b.id}
                  className="grade-bloqueio"
                  data-fundo="1"
                  style={{ top: px(b.de), height: px(b.ate) - px(b.de) }}
                  title={b.motivo ?? "Bloqueado"}
                >
                  <span>{b.motivo ?? "Bloqueado"}</span>
                </div>
              ))}

              {chave === hoje && minutosDoDia(agora) >= inicioMin && minutosDoDia(agora) <= fimMin && (
                <div className="grade-agora" style={{ top: px(minutosDoDia(agora)) }} aria-hidden="true" />
              )}

              {fantasma?.dia === chave && (
                <div
                  className="grade-fantasma"
                  style={{ top: px(fantasma.minutos), height: (fantasma.duracao / 60) * ALTURA_HORA }}
                >
                  {paraHHMM(fantasma.minutos)}
                </div>
              )}

              {(faixas.porDia.get(chave) ?? []).map((a) => {
                const inicio = minutosDoDia(new Date(a.quando));
                const lane = faixas.lanes.get(a.id) ?? { faixa: 0, total: 1 };
                const alturaCard = Math.max(22, (a.duracaoMin / 60) * ALTURA_HORA - 2);
                const podeArrastar = !a.semDesfecho && a.status !== "DONE" && a.status !== "NOSHOW";
                return (
                  <button
                    type="button"
                    key={a.id}
                    className={`grade-evento ${classeDoStatus(a)}${alturaCard < 40 ? " curto" : ""}`}
                    style={{
                      top: px(inicio) + 1,
                      height: alturaCard,
                      left: `calc(${(lane.faixa / lane.total) * 100}% + 2px)`,
                      width: `calc(${100 / lane.total}% - 4px)`,
                    }}
                    draggable={podeArrastar}
                    onDragStart={(e) => {
                      arrastado.current = a;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", a.id);
                    }}
                    onDragEnd={() => {
                      arrastado.current = null;
                      setFantasma(null);
                    }}
                    onClick={() => aoAbrir(a)}
                    title={`${hora(a.quando)} ${a.nome ?? "Sem nome"}, ${a.servico}${podeArrastar ? ". Arraste para remarcar." : ""}`}
                  >
                    <span className="evento-linha">
                      <span className="evento-hora">{hora(a.quando)}</span>
                      {a.status === "CONFIRMED" && !a.semDesfecho && (
                        <IconeCheck tamanho={13} className="evento-icone" />
                      )}
                      <span className="evento-nome">{a.nome ?? "Sem nome"}</span>
                    </span>
                    {alturaCard >= 40 && <span className="evento-servico">{a.servico}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GradeMes({
  referencia,
  de,
  agendamentos,
  aoAbrir,
  aoIrParaDia,
  aoRemarcar,
  aoNovo,
}: Props & { de: Date; agendamentos: Agendamento[] }) {
  const hoje = diaLocal(new Date());
  const mes = referencia.getMonth();
  const arrastado = useRef<Agendamento | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const porDia = new Map<string, Agendamento[]>();
  for (const a of agendamentos) {
    const chave = diaLocal(new Date(a.quando));
    porDia.set(chave, [...(porDia.get(chave) ?? []), a]);
  }

  // No mes a celula nao tem altura de hora: arrastar muda o DIA e mantem a hora.
  // Para mudar a hora existe a semana, o dia e o detalhe do agendamento.
  const soltar = (chave: string) => {
    const item = arrastado.current;
    arrastado.current = null;
    setAlvo(null);
    if (!item) return;
    const atual = new Date(item.quando);
    if (diaLocal(atual) === chave) return;
    const hhmm = paraHHMM(minutosDoDia(atual));
    aoRemarcar(item, `${chave}T${hhmm}`);
  };

  return (
    <div className="grade-mes">
      {["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((n) => (
        <div key={n} className="mes-cabeca">
          {n}
        </div>
      ))}
      {Array.from({ length: 42 }, (_, i) => somarDias(de, i)).map((d) => {
        const chave = diaLocal(d);
        const itens = porDia.get(chave) ?? [];
        const classes = [
          "mes-dia",
          d.getMonth() !== mes ? "fora" : "",
          chave === hoje ? "hoje" : "",
          alvo === chave ? "recebendo" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div
            key={chave}
            className={classes}
            // Clicar no vazio do dia marca naquele dia, como na semana (achado do dono,
            // 26/09/2026: no mes nao dava para marcar). O numero leva para o Dia.
            onClick={(e) => {
              if (e.target === e.currentTarget) aoNovo(chave);
            }}
            title="Clique para marcar neste dia"
            onDragOver={(e) => {
              if (!arrastado.current) return;
              e.preventDefault();
              if (alvo !== chave) setAlvo(chave);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setAlvo(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              soltar(chave);
            }}
          >
            <button type="button" className="mes-numero" onClick={() => aoIrParaDia(d)} aria-label={`Abrir ${d.toLocaleDateString("pt-BR")}`}>
              {d.getDate()}
            </button>
            <button
              type="button"
              className="mes-marcar"
              onClick={() => aoNovo(chave)}
              aria-label={`Marcar em ${d.toLocaleDateString("pt-BR")}`}
              title="Marcar neste dia"
            >
              <IconeMais tamanho={14} />
            </button>
            {itens.slice(0, 3).map((a) => {
              const podeArrastar = !a.semDesfecho && a.status !== "DONE" && a.status !== "NOSHOW";
              return (
                <button
                  type="button"
                  key={a.id}
                  className={`mes-evento ${classeDoStatus(a)}`}
                  draggable={podeArrastar}
                  onDragStart={(e) => {
                    arrastado.current = a;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", a.id);
                  }}
                  onDragEnd={() => {
                    arrastado.current = null;
                    setAlvo(null);
                  }}
                  onClick={() => aoAbrir(a)}
                  title={`${hora(a.quando)} ${a.nome ?? "Sem nome"}${podeArrastar ? ". Arraste para outro dia, no mesmo horário." : ""}`}
                >
                  <span className="evento-hora">{hora(a.quando)}</span> {a.nome ?? "Sem nome"}
                </button>
              );
            })}
            {itens.length > 3 && (
              <button type="button" className="mes-mais" onClick={() => aoIrParaDia(d)}>
                mais {itens.length - 3}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
