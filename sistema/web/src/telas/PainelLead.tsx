import { useCallback, useEffect, useRef, useState } from "react";
import { ErroApi, api } from "../api";
import type { Lead } from "../api";
import {
  dataHora,
  desde,
  diaEHora,
  moeda,
  nomeExibido,
  quandoNaLista,
  rotuloDoCampo,
  rotuloStatus,
} from "../formato";
import {
  IconeAgenda,
  IconeDocumento,
  IconeEstagioGanho,
  IconeEstagioPerdido,
  IconeEtiqueta,
  IconeFechar,
  IconeFunil,
  IconeLixeira,
  IconePessoa,
  IconeProgresso,
  IconeRelogio,
  IconeTelefone,
  IconeTendencia,
} from "../icones";
import { EscolherEtiquetas } from "../etiquetas";
import { EscolherResponsavel, type QuemAtende } from "../responsavel";
import { TextoEditavel, primeiraMaiuscula } from "../editavel";
import { useConfirmar } from "../confirmar";

/**
 * Janela do lead: abre ao clicar num card do funil.
 *
 * Para quem: o dono decidindo o que fazer com UMA pessoa. Acao mais importante:
 * assumir a conversa, que leva para a tela de Conversas. O que ela comunica: quem e
 * a pessoa, em que pe esta, o que ficou marcado e o que ja aconteceu.
 *
 * Desenho da referencia escolhida pelo dono (25/09/2026): janela no centro, com o
 * nome grande, uma grade de propriedades, o resumo da IA como descricao e, a direita,
 * a atividade. Antes era uma gaveta lateral de 440px.
 *
 * Nao tem conversa aqui (24/09/2026): balao tem altura imprevisivel e estourava a
 * tela. Conversa vive so em Conversas, e "Assumir conversa" e o caminho ate ela.
 */

/** Resumo e anotacao nao sao acontecimento: a atividade e o que mudou de estado. */
const EVENTOS_ESCONDIDOS = new Set(["summary", "note"]);

export interface EstagioDaJanela {
  id: string;
  nome: string;
  ganho?: boolean;
  perdido?: boolean;
  /** Progresso da coluna no caminho do funil, de 0 a 1 (o mesmo icone da coluna). */
  fracao?: number;
}

export function PainelLead({
  id,
  estagios,
  etiquetas,
  rotulosDeCampos,
  nomeDaIa = "Atendente",
  nomeDaPessoa = "Você",
  aoFechar,
  aoMudar,
  aoIrParaConversa,
}: {
  id: string;
  /** Lista do funil, para mover o lead sem precisar arrastar (funciona no celular). */
  estagios: EstagioDaJanela[];
  /** Vocabulário de etiquetas do negócio — o mesmo que a IA recebe. */
  etiquetas: string[];
  /** Rótulo de cada campo coletado, como a configuração do negócio escreveu. */
  rotulosDeCampos?: Record<string, string>;
  /** Nome da atendente (IA) e de quem usa o CRM, para o seletor de responsavel. */
  nomeDaIa?: string;
  nomeDaPessoa?: string;
  aoFechar: () => void;
  aoMudar: (idMovido?: string) => Promise<void>;
  /** Leva para a tela de Conversas com esta conversa aberta. */
  aoIrParaConversa?: (conversaId: string) => void;
}) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setLead(await api.lead(id));
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Este lead não carregou. Feche e abra de novo.");
    }
  }, [id]);

  useEffect(() => {
    void carregar();
    const relogio = setInterval(() => void carregar(), 8000);
    return () => clearInterval(relogio);
  }, [carregar]);

  // Esc fecha: quem usa CRM o dia inteiro espera isso.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const [comentario, setComentario] = useState("");
  // O mais novo fica embaixo, perto da caixa de comentario: a lista abre rolada ate
  // o fim e desce de novo quando chega um evento novo.
  const linhaDoTempo = useRef<HTMLDivElement>(null);
  const totalDeEventos = lead?.eventos.length ?? 0;
  useEffect(() => {
    const el = linhaDoTempo.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [totalDeEventos]);
  const [salvandoComentario, setSalvandoComentario] = useState(false);
  const confirmar = useConfirmar();

  const comentar = async () => {
    const texto = comentario.trim();
    if (!texto || salvandoComentario) return;
    setSalvandoComentario(true);
    try {
      await api.comentar(id, texto);
      setComentario("");
      await carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "O comentário não foi salvo. Tente de novo.");
    } finally {
      setSalvandoComentario(false);
    }
  };

  const apagarComentario = async (eventoId: string) => {
    const r = await confirmar({ titulo: "Apagar este comentário?", acao: "Apagar comentário", perigoso: true });
    if (!r.ok) return;
    try {
      await api.apagarComentario(id, eventoId);
      await carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "O comentário não foi apagado. Tente de novo.");
    }
  };

  const executar = async (acao: () => Promise<unknown>, idMovido?: string) => {
    try {
      await acao();
      await carregar();
      await aoMudar(idMovido);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "A ação não foi concluída. Tente de novo.");
    }
  };

  /**
   * Trocar o responsavel e o antigo "Assumir conversa" (25/09/2026): para voce,
   * a IA para de responder nesta conversa; para a IA, ela volta a atender.
   */
  const trocarResponsavel = (novo: QuemAtende) => {
    const conversa = lead?.conversa;
    if (!conversa) return;
    void executar(() =>
      novo === "voce" ? api.assumirConversa(conversa.id) : api.devolverConversa(conversa.id),
    );
  };

  // Mesma regra do selo do card: com a equipe, ou IA pausada porque alguem respondeu
  // pelo celular. Devolver para a IA desfaz as duas coisas.
  const pausada = Boolean(
    lead?.conversa?.pausadoAte && new Date(lead.conversa.pausadoAte) > new Date(),
  );
  const comHumano = lead?.conversa?.modo === "HUMAN" || pausada;
  // Lista fixa, na ordem da configuracao, com os vazios tambem: se so aparecesse o
  // que tem valor, cada lead teria os campos num lugar diferente (achado do dono,
  // 25/09/2026). Campo que a IA coletou fora da configuracao entra no fim.
  const coletados = (lead?.contato.campos ?? {}) as Record<string, unknown>;
  const configurados = Object.keys(rotulosDeCampos ?? {});
  const campos: [string, unknown][] = [
    ...configurados.map((chave): [string, unknown] => [chave, coletados[chave] ?? null]),
    ...Object.entries(coletados).filter(
      ([chave, valor]) => !configurados.includes(chave) && valor !== null && valor !== "",
    ),
  ];
  // Em ordem de acontecimento, do mais antigo ao mais novo, como uma conversa: o
  // comentario entra entre os registros da IA na hora em que foi escrito (pedido do
  // dono, 26/09/2026). O servidor manda do mais novo para o mais antigo.
  const historico = (lead?.eventos ?? [])
    .filter((e) => !EVENTOS_ESCONDIDOS.has(e.type))
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const estagioAtual = estagios.find((e) => e.id === lead?.estagio.id);

  return (
    <div className="cortina centralizada" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="janela-lead" role="dialog" aria-modal="true" aria-labelledby="janela-lead-nome">
        <header className="janela-lead-topo">
          <div className="trilha">
            <IconeFunil tamanho={15} className="icone" />
            <span>Funil</span>
            <span className="separador" aria-hidden="true">
              /
            </span>
            <strong>{lead?.estagio.nome ?? ""}</strong>
          </div>
          {lead && <span className="criado-em">Entrou {quandoEntrou(lead.criadoEm)}</span>}
          <button type="button" className="fechar-gaveta" onClick={aoFechar} aria-label="Fechar">
            <IconeFechar tamanho={18} />
          </button>
        </header>

        <div className="janela-lead-corpo">
          <main className="janela-lead-principal">
            {erro && <div className="aviso erro">{erro}</div>}

            <h2 id="janela-lead-nome">
              {lead ? (
                <TextoEditavel
                  valor={lead.contato.nome ?? ""}
                  vazio={lead.contato.telefoneFormatado}
                  rotulo="Nome"
                  exibir={nomeExibido}
                  editar={nomeExibido}
                  aoSalvar={(novo) => {
                    // Nome em branco nao apaga: o card cairia no telefone sem ninguem pedir.
                    if (novo) void executar(() => api.atualizarContato(lead.contato.id, { nome: novo }));
                  }}
                />
              ) : (
                "Carregando"
              )}
            </h2>

            {lead && (
              <>
                {comHumano && (
                  <div className="aviso atencao">
                    <strong>A IA está parada nesta conversa.</strong> Enquanto a conversa
                    estiver com você, ninguém responde automaticamente.
                    {lead.conversa?.motivoTransferencia && (
                      <div style={{ marginTop: 4 }}>Motivo: {lead.conversa.motivoTransferencia}</div>
                    )}
                  </div>
                )}

                <dl className="propriedades">
                  <Propriedade icone={<IconeProgresso fracao={0.5} tamanho={16} />} rotulo="Estágio">
                    {/* A pilula e o proprio seletor: mover o lead e mudar esta propriedade. */}
                    <label className={`pilula-estagio${estagioAtual?.ganho ? " ganho" : estagioAtual?.perdido ? " perdido" : estagioAtual?.fracao === 0 ? " inicio" : ""}`}>
                      <IconeDoEstagio estagio={estagioAtual} />
                      <select
                        value={lead.estagio.id}
                        aria-label="Mover para"
                        onChange={(e) =>
                          void executar(() => api.moverLead(lead.id, e.target.value), lead.id)
                        }
                      >
                        {estagios.map((estagio) => (
                          <option key={estagio.id} value={estagio.id}>
                            {estagio.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                  </Propriedade>

                  <Propriedade icone={<IconePessoa tamanho={16} />} rotulo="Responsável">
                    <EscolherResponsavel
                      quem={comHumano ? "voce" : "ia"}
                      nomeDaIa={nomeDaIa}
                      nomeDaPessoa={nomeDaPessoa}
                      desativado={!lead.conversa}
                      aoMudar={trocarResponsavel}
                    />
                  </Propriedade>

                  <Propriedade icone={<IconeTelefone tamanho={16} />} rotulo="Telefone">
                    <span className="numero">{lead.contato.telefoneFormatado}</span>
                  </Propriedade>

                  <Propriedade icone={<IconeEtiqueta tamanho={16} />} rotulo="Etiquetas">
                    <EscolherEtiquetas
                      marcadas={lead.contato.tags}
                      vocabulario={etiquetas}
                      aoMudar={(tags) =>
                        void executar(() => api.atualizarContato(lead.contato.id, { tags }))
                      }
                    />
                  </Propriedade>

                  <Propriedade icone={<IconeRelogio tamanho={16} />} rotulo="Último contato">
                    {primeiraMaiuscula(desde(lead.ultimoContatoEm))}
                  </Propriedade>

                  <Propriedade icone={<IconeTendencia tamanho={16} />} rotulo="Valor">
                    <TextoEditavel
                      valor={lead.valor != null ? String(lead.valor).replace(".", ",") : ""}
                      rotulo="Valor"
                      className="valor-lead"
                      exibir={(v) => moeda(lerReais(v))}
                      editar={(v) => v}
                      aoSalvar={(novo) => {
                        const reais = novo ? lerReais(novo) : null;
                        // Texto que nao e numero nao vira zero: fica o valor que estava.
                        if (reais !== null && Number.isNaN(reais)) return;
                        void executar(() => api.atualizarValor(lead.id, reais));
                      }}
                    />
                  </Propriedade>

                  {campos.map(([chave, valor]) => (
                    <Propriedade
                      key={chave}
                      icone={<IconeDocumento tamanho={16} />}
                      rotulo={rotuloDoCampo(chave, rotulosDeCampos)}
                    >
                      <TextoEditavel
                        valor={valor == null ? "" : String(valor)}
                        rotulo={rotuloDoCampo(chave, rotulosDeCampos)}
                        aoSalvar={(novo) =>
                          void executar(() =>
                            api.atualizarContato(lead.contato.id, { campos: { [chave]: novo } }),
                          )
                        }
                      />
                    </Propriedade>
                  ))}
                </dl>

                {(lead.resumo || lead.proximoPasso) && (
                  <section className="descricao-lead">
                    {lead.resumo && <p>{lead.resumo}</p>}
                    {lead.proximoPasso && (
                      <p className="proximo-passo">Próximo passo: {lead.proximoPasso}</p>
                    )}
                  </section>
                )}

                {lead.agendamentos.length > 0 && (
                  <section className="secao-lead">
                    <h3>Agendamentos</h3>
                    <div className="lista-agendamentos">
                      {lead.agendamentos.map((a) => (
                        <div className="linha-agendamento" key={a.id}>
                          <IconeAgenda tamanho={16} className="icone" />
                          <div>
                            <strong>{a.servico}</strong>
                            <span className="quando">{diaEHora(a.quando)}</span>
                          </div>
                          <span className="etiqueta">{rotuloStatus(a.status)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </main>

          <aside className="janela-lead-atividade">
            <h3>Atividade</h3>
            <div className="linha-do-tempo" ref={linhaDoTempo}>
              {historico.map((evento) =>
                evento.type === "comment" ? (
                  <div key={evento.id} className="comentario">
                    <div className="comentario-topo">
                      <strong>{nomeDaPessoa}</strong>
                      <span className="quando">{dataHora(evento.createdAt)}</span>
                      <button
                        type="button"
                        className="apagar-comentario"
                        title="Apagar comentário"
                        aria-label="Apagar comentário"
                        onClick={() => void apagarComentario(evento.id)}
                      >
                        <IconeLixeira tamanho={14} />
                      </button>
                    </div>
                    <div className="comentario-texto">{evento.body}</div>
                  </div>
                ) : (
                  <div key={evento.id}>
                    <div>{evento.body}</div>
                    <span className="quando">
                      {dataHora(evento.createdAt)}, {quemFez(evento.author)}
                    </span>
                  </div>
                ),
              )}
              {lead && historico.length === 0 && <p className="vazio">Nada por aqui ainda.</p>}
            </div>

            {/* Comentario da equipe, como na referencia (pedido do dono, 26/09/2026):
                Enter salva, Shift+Enter quebra a linha. As acoes ficam logo abaixo. */}
            {lead && (
              <form
                className="caixa-comentario"
                onSubmit={(e) => {
                  e.preventDefault();
                  void comentar();
                }}
              >
                <textarea
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void comentar();
                    }
                    // Esc com texto escrito desiste do texto, sem fechar a janela.
                    if (e.key === "Escape" && comentario) {
                      e.nativeEvent.stopPropagation();
                      setComentario("");
                    }
                  }}
                  placeholder="Escrever um comentário"
                  aria-label="Escrever um comentário"
                  rows={2}
                  maxLength={2000}
                />
                {comentario.trim() && (
                  <button type="submit" className="botao pequeno" disabled={salvandoComentario}>
                    Comentar
                  </button>
                )}
              </form>
            )}

            {lead && (
              <div className="acoes-lead">
                {/* So leva ate a conversa: quem atende se troca em "Responsavel". */}
                <button
                  type="button"
                  className="botao"
                  disabled={!lead.conversa}
                  onClick={() => lead.conversa && aoIrParaConversa?.(lead.conversa.id)}
                >
                  Abrir conversa
                </button>
                <a
                  className="botao discreto"
                  href={`https://wa.me/${lead.contato.telefone}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir no WhatsApp
                </a>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function Propriedade({
  icone,
  rotulo,
  children,
}: {
  icone: React.ReactNode;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="propriedade">
      <dt>
        <span className="icone">{icone}</span>
        {rotulo}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Estagios com o progresso de cada um, no formato da janela. Um calculo so para o
 * Funil e Contatos: a primeira coluna aberta e 0 (circulo tracejado) e cada
 * seguinte enche mais; ganho e perdido tem icone proprio.
 */
export function estagiosParaJanela(
  estagios: { id: string; nome: string; ganho: boolean; perdido: boolean }[],
): EstagioDaJanela[] {
  const abertas = estagios.filter((e) => !e.ganho && !e.perdido);
  return estagios.map((e) => ({
    id: e.id,
    nome: e.nome,
    ganho: e.ganho,
    perdido: e.perdido,
    fracao: e.ganho || e.perdido ? 1 : abertas.indexOf(e) / abertas.length,
  }));
}

export function IconeDoEstagio({ estagio }: { estagio?: EstagioDaJanela }) {
  if (estagio?.ganho) return <IconeEstagioGanho tamanho={15} className="icone-estagio" />;
  if (estagio?.perdido) return <IconeEstagioPerdido tamanho={15} className="icone-estagio" />;
  return <IconeProgresso fracao={estagio?.fracao ?? 0} tamanho={15} className="icone-estagio" />;
}

/** Autor do evento como a pessoa le: "ia" e "humano" sao nomes internos. */
function quemFez(autor: string): string {
  if (autor === "ia") return "pela IA";
  if (autor === "humano") return "pela equipe";
  return `por ${autor}`;
}

/** "ontem às 09:00", "hoje às 14:10", "segunda às 08:30", "12/09 às 10:00". */
function quandoEntrou(iso: string): string {
  const dia = quandoNaLista(iso);
  const hora = new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return /^\d{2}:\d{2}$/.test(dia) ? `hoje às ${hora}` : `${dia} às ${hora}`;
}

/** "2.500,00", "2500", "R$ 2.500" viram 2500. Texto que nao e numero vira NaN. */
function lerReais(texto: string): number {
  const limpo = texto.replace(/[^\d,.-]/g, "");
  // Com virgula, o ponto e separador de milhar ("2.500,50"); sem virgula, "2.500"
  // tambem e milhar, mas "25.5" e decimal: so e milhar se vier com tres digitos depois.
  const normal = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : /\.\d{3}$/.test(limpo)
      ? limpo.replace(/\./g, "")
      : limpo;
  return normal ? Number(normal) : Number.NaN;
}
