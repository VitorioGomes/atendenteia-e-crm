import { useCallback, useEffect, useState } from "react";
import { ErroApi, api } from "../api";
import type {
  AbaAgenda,
  Agendamento,
  Bloqueio,
  HorarioLivre,
  HorariosSemana,
  ListaAgenda,
  Servico,
} from "../api";
import { diaPorExtenso, hora } from "../formato";
import { Avatar } from "../avatar";
import { Modal } from "../modal";
import { useConfirmar } from "../confirmar";
import {
  GradeAgenda,
  diaLocal,
  inicioDoDia,
  somarDias,
  tituloDoPeriodo,
  type Visao,
} from "./GradeAgenda";
import { IconeAlerta, IconeBloqueio, IconeBusca, IconeMais, IconeSeta } from "../icones";

/**
 * Agenda.
 *
 * Ela so vale alguma coisa se refletir a realidade: encaixe feito no balcao,
 * feriado, ferias. Enquanto a agenda mentir, a IA vende horario que nao existe.
 * Por isso esta tela cria, remarca, cancela e bloqueia — tudo passando pela
 * mesma validacao que a IA usa no WhatsApp.
 */

const hojeISO = () => diaLocal(new Date());

type Modo = Visao | "lista";
const MODOS: { id: Modo; rotulo: string }[] = [
  { id: "dia", rotulo: "Dia" },
  { id: "semana", rotulo: "Semana" },
  { id: "mes", rotulo: "Mês" },
  { id: "lista", rotulo: "Lista" },
];
const CHAVE_MODO = "crm.agenda-modo";

/** No computador abre na semana; no celular, no dia (sete colunas não cabem). */
function modoInicial(): Modo {
  try {
    const salvo = localStorage.getItem(CHAVE_MODO);
    if (salvo && MODOS.some((m) => m.id === salvo)) return salvo as Modo;
  } catch {
    /* sem armazenamento: vale o padrão */
  }
  return window.innerWidth < 860 ? "dia" : "semana";
}

const ABAS: { id: AbaAgenda; rotulo: string }[] = [
  { id: "proximos", rotulo: "Hoje e próximos" },
  { id: "passados", rotulo: "Passados" },
  { id: "cancelados", rotulo: "Cancelados" },
];

const VAZIO: Record<AbaAgenda, string> = {
  proximos:
    "Nada marcado de hoje em diante. Quando a IA marcar um horário, ele aparece aqui. Quem ligou no telefone entra em \"Novo agendamento\", senão a IA oferece esse horário para outra pessoa.",
  passados: "Nenhum atendimento antes de hoje.",
  cancelados: "Nenhum agendamento cancelado.",
};

export function Agenda({
  servicos,
  horarios = {},
}: {
  servicos: Servico[];
  horarios?: HorariosSemana;
}) {
  const [modo, setModo] = useState<Modo>(modoInicial);
  const [referencia, setReferencia] = useState(() => inicioDoDia(new Date()));
  const [versao, setVersao] = useState(0);
  const [aberto, setAberto] = useState<Agendamento | null>(null);
  const confirmar = useConfirmar();
  const [novoEm, setNovoEm] = useState<{ dia: string; hora?: string } | null>(null);
  const [aba, setAba] = useState<AbaAgenda>("proximos");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [lista, setLista] = useState<ListaAgenda | null>(null);
  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [mostrarBloqueios, setMostrarBloqueios] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(async () => {
    try {
      const [dados, blocos] = await Promise.all([api.agenda(aba, buscaAplicada), api.bloqueios()]);
      setLista(dados);
      setBloqueios(blocos);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "A agenda não carregou. Recarregue a página.");
    }
  }, [aba, buscaAplicada]);

  useEffect(() => {
    void carregar();
    const relogio = setInterval(() => void carregar(), 30_000);
    return () => clearInterval(relogio);
  }, [carregar]);

  const executar = async (acao: () => Promise<unknown>, aviso?: string) => {
    setErro(null);
    try {
      await acao();
      if (aviso) setRecado(aviso);
      setVersao((v) => v + 1);
      await carregar();
      return true;
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "A ação não foi concluída. Tente de novo.");
      return false;
    }
  };

  const cancelar = async (item: Agendamento) => {
    const r = await confirmar({
      titulo: `Cancelar ${item.servico} de ${item.nome ?? "sem nome"}?`,
      mensagem: "O horário fica livre para a IA oferecer a outra pessoa, e o lembrete não sai.",
      acao: "Cancelar agendamento",
      perigoso: true,
      campo: { rotulo: "Motivo (opcional)", dica: "Ex.: viagem, vai remarcar" },
    });
    if (!r.ok) return;
    setAberto(null);
    await executar(
      () => api.cancelarAgendamento(item.id, r.texto || undefined),
      "Agendamento cancelado e horário liberado.",
    );
  };

  const marcar = (item: Agendamento, status: Agendamento["status"]) =>
    void executar(() => api.atualizarAgendamento(item.id, status));

  const trocarModo = (m: Modo) => {
    setModo(m);
    try {
      localStorage.setItem(CHAVE_MODO, m);
    } catch {
      /* só não lembra */
    }
  };

  // Setas andam um dia, uma semana ou um mês, conforme o que está na tela.
  const andar = (sentido: 1 | -1) => {
    if (modo === "dia") setReferencia((r) => somarDias(r, sentido));
    else if (modo === "semana") setReferencia((r) => somarDias(r, 7 * sentido));
    else if (modo === "mes") setReferencia((r) => new Date(r.getFullYear(), r.getMonth() + sentido, 1));
  };

  const remarcarArrastando = async (item: Agendamento, dataHora: string) => {
    const quando = new Date(dataHora);
    const texto = quando.toLocaleString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const r = await confirmar({
      titulo: `Remarcar ${item.nome ?? "este agendamento"}?`,
      mensagem: (
        <>
          Para <strong>{texto}</strong>. O lembrete vai junto.
        </>
      ),
      acao: "Remarcar",
    });
    if (!r.ok) return;
    void executar(
      () => api.remarcarAgendamento(item.id, dataHora),
      "Remarcado. O lembrete foi movido junto.",
    );
  };

  // Agrupa por dia: ninguém lê uma lista corrida de datas.
  const porDia = new Map<string, Agendamento[]>();
  for (const item of lista?.itens ?? []) {
    const chave = new Date(item.quando).toDateString();
    porDia.set(chave, [...(porDia.get(chave) ?? []), item]);
  }

  const semDesfecho = lista?.contagens.semDesfecho ?? 0;

  // Abre o mais antigo que ainda nao tem desfecho, ja com "A pessoa veio?".
  const abrirSemDesfecho = async () => {
    try {
      const passados = await api.agenda("passados", "");
      const pendentes = passados.itens.filter((a) => a.semDesfecho);
      const primeiro = pendentes.sort((a, b) => a.quando.localeCompare(b.quando))[0];
      if (primeiro) setAberto(primeiro);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "A agenda não carregou. Recarregue a página.");
    }
  };

  return (
    <>
      <div className="cabecalho">
        <h1>Agenda</h1>
        <div className="acoes">
          <button type="button" className="botao" onClick={() => setNovoEm({ dia: hojeISO() })}>
            <IconeMais tamanho={16} className="icone" />
            Novo agendamento
          </button>
          <button
            type="button"
            className="botao secundario"
            onClick={() => setMostrarBloqueios((v) => !v)}
          >
            <IconeBloqueio tamanho={16} className="icone" />
            {mostrarBloqueios ? "Ocultar bloqueios" : `Bloqueios (${bloqueios.length})`}
          </button>
        </div>
      </div>

      {erro && <div className="aviso erro">{erro}</div>}
      {recado && (
        <div className="aviso ok" onAnimationEnd={() => setRecado(null)}>
          {recado}{" "}
          <button type="button" className="botao discreto" onClick={() => setRecado(null)}>
            ok
          </button>
        </div>
      )}

      {mostrarBloqueios && (
        <PainelBloqueios
          bloqueios={bloqueios}
          aoMudar={carregar}
          aoAvisar={setRecado}
          aoErrar={setErro}
        />
      )}

      <div className="navegacao-agenda">
        <div className="alternador modos" role="tablist" aria-label="Como ver a agenda">
          {MODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={modo === m.id}
              onClick={() => trocarModo(m.id)}
            >
              {m.rotulo}
            </button>
          ))}
        </div>

        {modo !== "lista" && (
          <div className="periodo">
            <button type="button" className="botao secundario" onClick={() => setReferencia(inicioDoDia(new Date()))}>
              Hoje
            </button>
            <button type="button" className="botao-icone" onClick={() => andar(-1)} aria-label="Anterior">
              <IconeSeta tamanho={18} className="virada" />
            </button>
            <button type="button" className="botao-icone" onClick={() => andar(1)} aria-label="Próximo">
              <IconeSeta tamanho={18} />
            </button>
            <h2>{tituloDoPeriodo(modo, referencia)}</h2>
          </div>
        )}

        {/* Atendimento que passou sem dizer se a pessoa veio. Era uma faixa de aviso
            no topo da tela, que o dono achou um comentario perdido (26/09/2026):
            virou um botao na barra do calendario, que abre direto o primeiro que
            precisa de resposta. E dai que sai a taxa de comparecimento do Painel. */}
        {semDesfecho > 0 && (
          <button
            type="button"
            className="confirmar-presenca"
            onClick={() => void abrirSemDesfecho()}
            title="Atendimento que já passou sem marcar se a pessoa veio. É daí que sai a taxa de comparecimento do Painel."
          >
            <IconeAlerta tamanho={15} />
            Confirmar presença
            <span className="contagem">{semDesfecho}</span>
          </button>
        )}
      </div>

      {modo !== "lista" ? (
        <GradeAgenda
          visao={modo}
          referencia={referencia}
          horarios={horarios}
          versao={versao}
          aoAbrir={setAberto}
          aoNovo={(dia, hora) => setNovoEm({ dia, hora })}
          aoRemarcar={remarcarArrastando}
          aoIrParaDia={(d) => {
            setReferencia(d);
            trocarModo("dia");
          }}
          aoErro={setErro}
        />
      ) : (
        <>
        <div className="barra-agenda">
          <div className="alternador" role="tablist">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={aba === a.id}
                onClick={() => setAba(a.id)}
              >
                {a.rotulo}
                {lista && <span className="contagem">{lista.contagens[a.id]}</span>}
              </button>
            ))}
          </div>

          <label className="barra-busca compacta">
            <IconeBusca tamanho={16} className="icone" />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou telefone"
              aria-label="Buscar na agenda"
            />
          </label>
        </div>

        {lista === null && !erro && (
          <div className="agenda">
            {[0, 1, 2].map((i) => (
              <div key={i} className="esqueleto esqueleto-linha" />
            ))}
          </div>
        )}

        {lista?.itens.length === 0 && (
          <p className="vazio agenda-vazia">
            {buscaAplicada ? "Ninguém com esse nome ou telefone nesta aba." : VAZIO[aba]}
          </p>
        )}

        {[...porDia.entries()].map(([dia, itens]) => (
          <section key={dia}>
            <h2 className="dia-titulo">{diaPorExtenso(itens[0]!.quando)}</h2>

            <div className="agenda">
              {itens.map((item) => (
                <Compromisso
                  key={item.id}
                  item={item}
                  aoMarcar={(status) => marcar(item, status)}
                  aoRemarcar={() => setAberto(item)}
                  aoCancelar={() => void cancelar(item)}
                />
              ))}
            </div>
          </section>
        ))}

        {lista && lista.total > lista.itens.length && (
          <p className="vazio">
            Mostrando {lista.itens.length} de {lista.total}. Use a busca para achar os outros.
          </p>
        )}

        </>
      )}

      {aberto && (
        <DetalheAgendamento
          key={aberto.id}
          item={aberto}
          aoFechar={() => setAberto(null)}
          aoMarcar={(status) => {
            setAberto(null);
            marcar(aberto, status);
          }}
          aoRemarcar={async (dataHora) => {
            const deuCerto = await executar(
              () => api.remarcarAgendamento(aberto.id, dataHora),
              "Remarcado. O lembrete foi movido junto.",
            );
            if (deuCerto) setAberto(null);
            return deuCerto;
          }}
          aoCancelar={() => void cancelar(aberto)}
        />
      )}

      {novoEm && (
        <FormularioAgendamento
          servicos={servicos}
          diaInicial={novoEm.dia}
          horaInicial={novoEm.hora}
          aoFechar={() => setNovoEm(null)}
          aoSalvar={async (dados) => {
            const deuCerto = await executar(
              () => api.criarAgendamento(dados),
              "Agendamento criado.",
            );
            if (deuCerto) setNovoEm(null);
          }}
        />
      )}

    </>
  );
}

/**
 * Um horário. As ações mudam com o momento dele: o que vem se confirma, remarca ou
 * cancela; o que passou sem desfecho pede uma resposta só ("veio ou não veio?"); o
 * que já tem desfecho fica corrigível; o cancelado só informa.
 */
function Compromisso({
  item,
  aoMarcar,
  aoRemarcar,
  aoCancelar,
}: {
  item: Agendamento;
  aoMarcar: (status: Agendamento["status"]) => void;
  aoRemarcar: () => void;
  aoCancelar: () => void;
}) {
  const cancelado = item.status === "CANCELED";
  const passou = new Date(item.quando).getTime() < Date.now();

  const classes = ["compromisso", item.semDesfecho ? "sem-desfecho" : "", cancelado ? "cancelado" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={classes}>
      <div className="quando">
        {hora(item.quando)}
        <span className="duracao">{item.duracaoMin} min</span>
      </div>

      <Avatar nome={item.nome} telefone={item.telefone ?? item.telefoneFormatado} tamanho={32} />

      <div className="pessoa">
        <strong>{item.nome ?? "Sem nome"}</strong>
        <div className="detalhe">{item.servico}</div>
        <div className="detalhe telefone">{item.telefoneFormatado}</div>
        {item.observacao && (
          <div className="observacao">
            {cancelado ? `Motivo: ${item.observacao}` : item.observacao}
          </div>
        )}
      </div>

      <div className="acoes">
        {cancelado ? (
          <span className="etiqueta">Cancelado</span>
        ) : item.semDesfecho ? (
          <>
            <span className="pergunta-desfecho">A pessoa veio?</span>
            <button type="button" className="botao secundario" onClick={() => aoMarcar("DONE")}>
              Compareceu
            </button>
            <button type="button" className="botao secundario" onClick={() => aoMarcar("NOSHOW")}>
              Não veio
            </button>
            <button type="button" className="botao discreto" onClick={aoRemarcar}>
              Remarcar
            </button>
          </>
        ) : passou ? (
          <select
            className="campo"
            value={item.status}
            onChange={(e) => aoMarcar(e.target.value as Agendamento["status"])}
            aria-label="Desfecho do atendimento"
          >
            <option value="DONE">Compareceu</option>
            <option value="NOSHOW">Não veio</option>
            <option value="CONFIRMED">Confirmado</option>
            <option value="SCHEDULED">Agendado</option>
          </select>
        ) : (
          <>
            <select
              className="campo"
              value={item.status}
              onChange={(e) => aoMarcar(e.target.value as Agendamento["status"])}
              aria-label="Situação do agendamento"
            >
              <option value="SCHEDULED">Agendado</option>
              <option value="CONFIRMED">Confirmado</option>
              <option value="DONE">Compareceu</option>
              <option value="NOSHOW">Não veio</option>
            </select>
            <button type="button" className="botao secundario" onClick={aoRemarcar}>
              Remarcar
            </button>
            <button type="button" className="botao discreto" onClick={aoCancelar}>
              Cancelar
            </button>
          </>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Escolha de horário — como num calendário: dia e hora livres, com os horários
// vagos do dia como atalho. Quem decide se pode é o servidor, na hora de salvar.
// ---------------------------------------------------------------------------

function EscolhaDeHorario({
  dia,
  hora: horaEscolhida,
  servico,
  ignorar,
  aoMudarDia,
  aoMudarHora,
}: {
  dia: string;
  hora: string;
  servico?: string;
  ignorar?: string;
  aoMudarDia: (dia: string) => void;
  aoMudarHora: (hora: string) => void;
}) {
  const [livres, setLivres] = useState<HorarioLivre[] | null>(null);

  useEffect(() => {
    let ativo = true;
    setLivres(null);
    api
      .horariosLivres({ dia, servico, ignorar })
      .then((lista) => ativo && setLivres(lista))
      .catch(() => ativo && setLivres([]));
    return () => {
      ativo = false;
    };
  }, [dia, servico, ignorar]);

  return (
    <div className="escolha-horario">
      <div className="escolha-campos">
        <label>
          Dia
          <input type="date" value={dia} onChange={(e) => aoMudarDia(e.target.value)} required />
        </label>
        <label>
          Hora
          <input
            type="time"
            value={horaEscolhida}
            step={300}
            onChange={(e) => aoMudarHora(e.target.value)}
            required
          />
        </label>
      </div>

      <div className="horarios-vagos">
        <span className="rotulo-vagos">Vagos nesse dia</span>
        {dia < hojeISO() ? (
          <span className="dica-vagos">
            Esse dia já passou. Vale para registrar um atendimento que aconteceu: escreva a hora
            em Hora.
          </span>
        ) : livres === null ? (
          <span className="dica-vagos">procurando</span>
        ) : livres.length === 0 ? (
          <span className="dica-vagos">
            Nenhum no horário de funcionamento. Você pode escrever a hora que quiser em Hora.
          </span>
        ) : (
          <div className="chips-vagos">
            {livres.map((h) => {
              const hh = h.valor.slice(11, 16);
              return (
                <button
                  key={h.valor}
                  type="button"
                  aria-pressed={hh === horaEscolhida}
                  onClick={() => aoMudarHora(hh)}
                >
                  {hh}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Novo agendamento
// ---------------------------------------------------------------------------

function FormularioAgendamento({
  servicos,
  diaInicial,
  horaInicial,
  aoFechar,
  aoSalvar,
}: {
  servicos: Servico[];
  /** Vindo de um clique na grade: já abre naquele dia e naquela hora. */
  diaInicial?: string;
  horaInicial?: string;
  aoFechar: () => void;
  aoSalvar: (dados: {
    telefone: string;
    nome?: string;
    servico: string;
    dataHora: string;
    observacao?: string;
  }) => Promise<void>;
}) {
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [servico, setServico] = useState(servicos[0]?.nome ?? "");
  const [dia, setDia] = useState(diaInicial ?? hojeISO());
  const [horaEscolhida, setHora] = useState(horaInicial ?? "");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (!dia || !horaEscolhida) return;
    setSalvando(true);
    await aoSalvar({
      telefone,
      nome: nome || undefined,
      servico,
      dataHora: `${dia}T${horaEscolhida}`,
      observacao: observacao || undefined,
    });
    setSalvando(false);
  };

  return (
    <Modal titulo="Novo agendamento" aoFechar={aoFechar}>
      <form onSubmit={enviar} className="formulario">
        <label>
          Telefone com DDD
          <input
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="(11) 98765-4321"
            required
            autoFocus
          />
          <small>
            Se essa pessoa já falou com a IA, o agendamento cai no card que já existe.
          </small>
        </label>

        <label>
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Opcional" />
        </label>

        <label>
          Serviço
          <select
            className="campo"
            value={servico}
            onChange={(e) => setServico(e.target.value)}
            required
          >
            {servicos.map((s) => (
              <option key={s.nome} value={s.nome}>
                {s.nome} ({s.duracaoMin} min)
              </option>
            ))}
          </select>
        </label>

        <EscolhaDeHorario
          dia={dia}
          hora={horaEscolhida}
          servico={servico}
          aoMudarDia={setDia}
          aoMudarHora={setHora}
        />

        <label>
          Observação
          <input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Opcional"
          />
        </label>

        <div className="acoes">
          <button type="submit" className="botao" disabled={salvando || !horaEscolhida}>
            {salvando ? "Salvando" : "Agendar"}
          </button>
          <button type="button" className="botao secundario" onClick={aoFechar}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Detalhe de um agendamento: tudo que se faz com ele, num lugar só
// ---------------------------------------------------------------------------

const SITUACOES: { status: Agendamento["status"]; rotulo: string }[] = [
  { status: "SCHEDULED", rotulo: "Agendado" },
  { status: "CONFIRMED", rotulo: "Confirmado" },
  { status: "DONE", rotulo: "Compareceu" },
  { status: "NOSHOW", rotulo: "Não veio" },
];

function DetalheAgendamento({
  item,
  aoFechar,
  aoMarcar,
  aoRemarcar,
  aoCancelar,
}: {
  item: Agendamento;
  aoFechar: () => void;
  aoMarcar: (status: Agendamento["status"]) => void;
  aoRemarcar: (dataHora: string) => Promise<boolean>;
  aoCancelar: () => void;
}) {
  const quando = new Date(item.quando);
  const diaAtual = diaLocal(quando);
  const horaAtual = hora(item.quando);
  const [dia, setDia] = useState(diaAtual);
  const [horaEscolhida, setHora] = useState(horaAtual);
  const [salvando, setSalvando] = useState(false);
  const mudou = dia !== diaAtual || horaEscolhida !== horaAtual;
  const cancelado = item.status === "CANCELED";

  return (
    <Modal titulo={item.nome ?? "Sem nome"} aoFechar={aoFechar}>
      <div className="detalhe-agendamento">
        <div className="detalhe-quem">
          <Avatar nome={item.nome} telefone={item.telefone ?? item.telefoneFormatado} tamanho={40} />
          <div>
            <strong>{item.servico}</strong>
            <span>{item.duracaoMin} min</span>
            <span className="telefone">{item.telefoneFormatado}</span>
          </div>
          {item.criadoPor === "ia" && <span className="etiqueta info">Marcado pela IA</span>}
        </div>

        {item.observacao && <p className="detalhe-observacao">{item.observacao}</p>}

        {cancelado ? (
          <div className="aviso">Este agendamento foi cancelado.</div>
        ) : (
          <>
            <section>
              <h3>{item.semDesfecho ? "A pessoa veio?" : "Situação"}</h3>
              <div className="alternador situacoes" role="group" aria-label="Situação do agendamento">
                {SITUACOES.map((s) => (
                  <button
                    key={s.status}
                    type="button"
                    aria-pressed={item.status === s.status}
                    className={item.semDesfecho && (s.status === "DONE" || s.status === "NOSHOW") ? "destaque" : ""}
                    onClick={() => item.status !== s.status && aoMarcar(s.status)}
                  >
                    {s.rotulo}
                  </button>
                ))}
              </div>
            </section>

            <form
              className="formulario"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!mudou) return;
                setSalvando(true);
                await aoRemarcar(`${dia}T${horaEscolhida}`);
                setSalvando(false);
              }}
            >
              <h3>Quando</h3>
              <EscolhaDeHorario
                dia={dia}
                hora={horaEscolhida}
                servico={item.servico}
                ignorar={item.id}
                aoMudarDia={setDia}
                aoMudarHora={setHora}
              />
              <div className="acoes detalhe-rodape">
                <button type="submit" className="botao" disabled={!mudou || salvando}>
                  {salvando ? "Salvando" : "Salvar novo horário"}
                </button>
                <button type="button" className="botao discreto perigoso" onClick={aoCancelar}>
                  Cancelar agendamento
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Bloqueios
// ---------------------------------------------------------------------------

function PainelBloqueios({
  bloqueios,
  aoMudar,
  aoAvisar,
  aoErrar,
}: {
  bloqueios: Bloqueio[];
  aoMudar: () => Promise<void>;
  aoAvisar: (texto: string) => void;
  aoErrar: (texto: string) => void;
}) {
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  const diaInteiro = (data: string) => {
    setInicio(`${data}T00:00`);
    setFim(`${data}T23:59`);
  };

  const criar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setSalvando(true);
    try {
      const resultado = await api.criarBloqueio({ inicio, fim, motivo: motivo || undefined });
      setInicio("");
      setFim("");
      setMotivo("");
      aoAvisar(
        resultado.agendamentosNoPeriodo > 0
          ? `Bloqueio criado. ATENÇÃO: já existem ${resultado.agendamentosNoPeriodo} agendamento(s) nesse período — remarque essas pessoas.`
          : "Bloqueio criado. A IA não vai mais oferecer horários nesse período.",
      );
      await aoMudar();
    } catch (e) {
      aoErrar(e instanceof ErroApi ? e.message : "O bloqueio não foi criado. Confira as datas informadas.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className="caixa" style={{ marginBottom: 22 }}>
      <h3 style={{ marginTop: 0 }}>Bloqueios de agenda</h3>
      <p style={{ marginTop: 0, color: "var(--tinta-fraca)", fontSize: "var(--texto-menor)" }}>
        Feriado, férias, congresso, almoço. Enquanto o período estiver bloqueado, a IA não
        oferece nem aceita horário nele.
      </p>

      <form onSubmit={criar} className="formulario-linha">
        <label>
          Início
          <input
            type="datetime-local"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
            required
          />
        </label>
        <label>
          Fim
          <input
            type="datetime-local"
            value={fim}
            onChange={(e) => setFim(e.target.value)}
            required
          />
        </label>
        <label>
          Motivo
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Feriado, férias…"
          />
        </label>
        <div className="acoes">
          <button type="submit" className="botao" disabled={salvando || !inicio || !fim}>
            {salvando ? "Salvando…" : "Bloquear"}
          </button>
          <button
            type="button"
            className="botao secundario"
            onClick={() => diaInteiro(inicio.slice(0, 10) || hojeISO())}
            title="Preenche início e fim para cobrir o dia inteiro"
          >
            Dia inteiro
          </button>
        </div>
      </form>

      {bloqueios.length === 0 ? (
        <p className="vazio">nenhum bloqueio ativo</p>
      ) : (
        <div className="agenda" style={{ marginTop: 12 }}>
          {bloqueios.map((b) => (
            <article className="compromisso" key={b.id}>
              <div className="quando">
                {new Date(b.inicio).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <strong>{b.motivo ?? "Bloqueado"}</strong>
                <div style={{ color: "var(--tinta-fraca)", fontSize: "var(--texto-menor)" }}>
                  até{" "}
                  {new Date(b.fim).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <button
                type="button"
                className="botao discreto"
                onClick={async () => {
                  await api.removerBloqueio(b.id);
                  await aoMudar();
                }}
              >
                Remover
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
