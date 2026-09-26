import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ErroApi, api } from "../api";
import type { ConversaResumo, Lead } from "../api";
import { desde, nomeExibido, quandoNaLista, rotuloDoDia } from "../formato";
import { Avatar } from "../avatar";
import { Balao } from "../balao";
import { Compositor, type ControleCompositor } from "../compositor";
import { IconeBusca } from "../icones";
import { EscolherResponsavel, SeloResponsavel, type QuemAtende } from "../responsavel";

/**
 * Caixa de entrada.
 *
 * Para quem: o dono ou a recepcionista, com a tela aberta durante o dia.
 * Ação principal: achar quem está esperando uma PESSOA e responder dali mesmo.
 * O que comunica: quem precisa de gente agora, quem a IA está cuidando, e quem disse
 * cada mensagem.
 *
 * O funil organiza por etapa de venda; aqui organiza por quem falou por último. O
 * laranja só acende quando precisa de gente de verdade (a regra mora em
 * src/crm/atencao.ts no servidor) — se acendesse a cada mensagem nova, o dono
 * aprenderia a ignorar.
 */

const INTERVALO_LISTA_MS = 5_000;
const INTERVALO_CONVERSA_MS = 4_000;

type Filtro = "todas" | "voce";

export function Conversas({
  filtroInicial = "todas",
  abrirConversa,
  nomeDaIa = "Atendente",
  nomeDaPessoa = "Você",
}: {
  filtroInicial?: Filtro;
  /** Nome da atendente (IA) e de quem usa o CRM, para o seletor de responsavel. */
  nomeDaIa?: string;
  nomeDaPessoa?: string;
  /**
   * Conversa para abrir assim que a lista chegar, vinda de outra tela ("Assumir
   * conversa", na gaveta do funil). O telefone vai junto porque a lista e paginada:
   * ele entra na busca e garante que a conversa esteja entre as que chegaram.
   */
  abrirConversa?: { id: string; telefone: string };
}) {
  const [filtro, setFiltro] = useState<Filtro>(filtroInicial);
  const [busca, setBusca] = useState(abrirConversa?.telefone ?? "");
  const [buscaAplicada, setBuscaAplicada] = useState(abrirConversa?.telefone ?? "");
  const [conversas, setConversas] = useState<ConversaResumo[] | null>(null);
  const [total, setTotal] = useState(0);
  const [comVoce, setComVoce] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<ConversaResumo | null>(null);

  // Espera a pessoa parar de digitar antes de buscar.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(async () => {
    try {
      const r = await api.conversas(filtro, buscaAplicada);
      setConversas(r.conversas);
      setTotal(r.total);
      setComVoce(r.comVoce);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "As conversas não carregaram. Recarregue a página.");
    }
  }, [filtro, buscaAplicada]);

  useEffect(() => {
    void carregar();
    const relogio = setInterval(() => void carregar(), INTERVALO_LISTA_MS);
    return () => clearInterval(relogio);
  }, [carregar]);

  // Chegou por "Assumir conversa", na gaveta do funil: abre sozinha, uma vez.
  const jaAbriu = useRef(false);
  useEffect(() => {
    if (jaAbriu.current || !abrirConversa || !conversas) return;
    const achada = conversas.find((c) => c.id === abrirConversa.id);
    if (!achada) return;
    jaAbriu.current = true;
    setAberta(achada);
  }, [abrirConversa, conversas]);

  // A linha aberta acompanha a lista: se a pessoa respondeu, o estado dela muda.
  const abertaAtual = aberta ? (conversas?.find((c) => c.id === aberta.id) ?? aberta) : null;

  return (
    <div className="tela-conversas">
      {/* Titulo no topo da pagina, com a contagem ao lado, como nas outras telas.
          Antes ficava dentro da caixa da lista (26/09/2026). */}
      <div className="cabecalho">
        <h1>
          Conversas
          {conversas !== null && <span className="contagem-titulo">{total}</span>}
        </h1>
      </div>

    <div className={`caixa-entrada${abertaAtual ? " com-aberta" : ""}`}>
      <aside className="lista-conversas">
        <div className="lista-topo">

          <div className="alternador" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={filtro === "todas"}
              onClick={() => setFiltro("todas")}
            >
              Todas
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filtro === "voce"}
              onClick={() => setFiltro("voce")}
            >
              Com você
              {comVoce > 0 && <span className="contagem info">{comVoce}</span>}
            </button>
          </div>

          <label className="barra-busca compacta">
            <IconeBusca tamanho={16} className="icone" />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou telefone"
              aria-label="Buscar conversa"
            />
          </label>
        </div>

        {erro && <div className="aviso erro">{erro}</div>}

        <div className="linhas">
          {conversas === null &&
            [0, 1, 2, 3, 4].map((i) => <div key={i} className="esqueleto esqueleto-linha" />)}

          {conversas?.length === 0 && (
            <p className="vazio">
              {buscaAplicada
                ? "Nenhuma conversa com esse nome ou telefone."
                : filtro === "voce"
                  ? "Nenhuma conversa com você agora. Quando a IA passar um atendimento, ele aparece aqui."
                  : "Nenhuma conversa ainda. Quando alguém mandar mensagem, aparece aqui."}
            </p>
          )}

          {conversas?.map((c) => (
            <LinhaConversa
              key={c.id}
              conversa={c}
              ativa={abertaAtual?.id === c.id}
              aoAbrir={() => setAberta(c)}
            />
          ))}

          {conversas && total > conversas.length && (
            <p className="vazio">
              Mostrando as {conversas.length} mais recentes de {total}. Use a busca para achar as
              outras.
            </p>
          )}
        </div>
      </aside>

      <section className="conversa-aberta">
        {abertaAtual ? (
          <ConversaAberta
            key={abertaAtual.id}
            resumo={abertaAtual}
            aoVoltar={() => setAberta(null)}
            aoMudar={carregar}
            nomeDaIa={nomeDaIa}
            nomeDaPessoa={nomeDaPessoa}
          />
        ) : (
          <div className="sem-conversa">
            <p>Escolha uma conversa para ler e responder.</p>
          </div>
        )}
      </section>
    </div>
    </div>
  );
}

function LinhaConversa({
  conversa,
  ativa,
  aoAbrir,
}: {
  conversa: ConversaResumo;
  ativa: boolean;
  aoAbrir: () => void;
}) {
  const ultima = conversa.ultimaMensagem;
  const comVoce = conversa.modo === "HUMAN" || conversa.pausado;
  const prefixo = ultima?.autor === "BOT" ? "IA: " : ultima?.autor === "HUMAN" ? "Você: " : "";

  const classes = [
    "linha-conversa",
    ativa ? "ativa" : "",
    conversa.precisaDeVoce ? "precisa" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={classes} onClick={aoAbrir} aria-current={ativa}>
      {/* Quem atende e o selo no canto do avatar, como no card do funil: estado nao
          e etiqueta (26/09/2026). */}
      <span className="avatar-com-selo" title={comVoce ? "Atendendo: você" : "Atendendo: IA"}>
        <Avatar nome={conversa.nome} telefone={conversa.telefone} tamanho={38} />
        <SeloResponsavel quem={comVoce ? "voce" : "ia"} tamanho={16} />
      </span>

      <div className="meio">
        <div className="primeira">
          <span className="nome">{nomeExibido(conversa.nome) || conversa.telefoneFormatado}</span>
          {conversa.precisaDeVoce && conversa.esperandoDesde ? (
            // Quem espera e o proprio tempo, em laranja, como no funil.
            <time className="esperando" dateTime={conversa.esperandoDesde}>
              Esperando {desde(conversa.esperandoDesde).replace(/^há /, "")}
            </time>
          ) : (
            ultima && <time dateTime={ultima.em}>{quandoNaLista(ultima.em)}</time>
          )}
        </div>

        <div className="segunda">
          <span className="previa">
            {prefixo}
            {ultima?.texto ?? ""}
          </span>
        </div>
      </div>
    </button>
  );
}

function ConversaAberta({
  resumo,
  aoVoltar,
  aoMudar,
  nomeDaIa,
  nomeDaPessoa,
}: {
  resumo: ConversaResumo;
  aoVoltar: () => void;
  aoMudar: () => Promise<void>;
  nomeDaIa: string;
  nomeDaPessoa: string;
}) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const areaMensagens = useRef<HTMLDivElement>(null);
  // Quem está lendo lá em cima não pode ser puxado para baixo a cada atualização.
  const noFim = useRef(true);
  const compositor = useRef<ControleCompositor>(null);
  // dragenter/dragleave disparam a cada filho; o contador diz quando saiu de verdade.
  const profundidade = useRef(0);

  const carregar = useCallback(async () => {
    if (!resumo.negocioId) {
      setErro("Esta conversa não tem card no funil, então não dá para abrir aqui.");
      return;
    }
    try {
      setLead(await api.lead(resumo.negocioId));
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "A conversa não carregou. Escolha de novo na lista.");
    }
  }, [resumo.negocioId]);

  useEffect(() => {
    void carregar();
    const relogio = setInterval(() => void carregar(), INTERVALO_CONVERSA_MS);
    return () => clearInterval(relogio);
  }, [carregar]);

  // Chegou mensagem nova (ou abriu a conversa): desce até a última — a menos que a
  // pessoa tenha subido para ler o histórico. O que ela mesma enviou sempre desce.
  const ultima = lead?.mensagens[lead.mensagens.length - 1];
  useEffect(() => {
    if (noFim.current || ultima?.author === "HUMAN") {
      fim.current?.scrollIntoView({ block: "end" });
    }
  }, [lead?.mensagens.length, ultima?.author]);

  // Foto e vídeo carregam depois e empurram a conversa para cima: acompanha.
  useEffect(() => {
    const el = areaMensagens.current;
    if (!el) return;
    const acompanhar = () => {
      if (noFim.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener("load", acompanhar, true);
    el.addEventListener("loadedmetadata", acompanhar, true);
    return () => {
      el.removeEventListener("load", acompanhar, true);
      el.removeEventListener("loadedmetadata", acompanhar, true);
    };
  }, []);

  const executar = async (acao: () => Promise<unknown>) => {
    try {
      await acao();
      await carregar();
      await aoMudar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "A ação não foi concluída. Tente de novo.");
    }
  };

  const aoEnviado = useCallback(async () => {
    await carregar();
    await aoMudar();
  }, [carregar, aoMudar]);

  const temArquivos = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  // Mesma regra do funil e da janela do lead: com a equipe, ou IA pausada porque
  // alguem respondeu pelo celular.
  const pausada = Boolean(
    lead?.conversa?.pausadoAte && new Date(lead.conversa.pausadoAte) > new Date(),
  );
  const comHumano = lead?.conversa?.modo === "HUMAN" || pausada;
  const nome = nomeExibido(lead?.contato.nome ?? lead?.contato.pushName ?? resumo.nome) || null;

  return (
    <div
      className="aberta"
      onDragEnter={(e) => {
        if (!temArquivos(e) || !lead?.conversa) return;
        profundidade.current++;
        setArrastando(true);
      }}
      onDragOver={(e) => {
        if (temArquivos(e) && lead?.conversa) e.preventDefault();
      }}
      onDragLeave={() => {
        profundidade.current = Math.max(0, profundidade.current - 1);
        if (profundidade.current === 0) setArrastando(false);
      }}
      onDrop={(e) => {
        if (!temArquivos(e)) return;
        e.preventDefault();
        profundidade.current = 0;
        setArrastando(false);
        compositor.current?.adicionarArquivos([...e.dataTransfer.files]);
      }}
    >
      {arrastando && (
        <div className="soltar-aqui" aria-hidden="true">
          <p>Solte para anexar</p>
        </div>
      )}

      <header className="aberta-topo">
        <button type="button" className="botao discreto voltar" onClick={aoVoltar}>
          Voltar
        </button>

        <Avatar nome={nome} telefone={resumo.telefone} tamanho={40} />
        <div className="quem">
          <h2>{nome ?? resumo.telefoneFormatado}</h2>
          <p>
            <span className="telefone">{resumo.telefoneFormatado}</span>
            {lead && <span className="pilula-estagio somente-leitura">{lead.estagio.nome}</span>}
          </p>
        </div>

        {/* Quem atende se troca aqui, como na janela do lead: no lugar dos antigos
            "Assumir conversa" e "Devolver para a IA". */}
        <div className="acoes">
          {lead?.conversa && (
            <div className="responsavel-conversa">
              <span className="rotulo-responsavel">Responsável</span>
              <EscolherResponsavel
                quem={comHumano ? "voce" : "ia"}
                nomeDaIa={nomeDaIa}
                nomeDaPessoa={nomeDaPessoa}
                aoMudar={(novo: QuemAtende) =>
                  void executar(() =>
                    novo === "voce"
                      ? api.assumirConversa(lead.conversa!.id)
                      : api.devolverConversa(lead.conversa!.id),
                  )
                }
              />
            </div>
          )}
        </div>
      </header>

      {erro && <div className="aviso erro">{erro}</div>}

      {lead?.resumo && (
        <div className="resumo-da-ia">
          <span className="rotulo">Resumo da IA</span>
          {lead.resumo}
          {lead.proximoPasso && <span className="proximo">Próximo passo: {lead.proximoPasso}</span>}
        </div>
      )}

      <div
        className="mensagens"
        ref={areaMensagens}
        onScroll={(e) => {
          const el = e.currentTarget;
          noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        {!lead && !erro && <div className="esqueleto" style={{ height: 180 }} />}
        {lead?.mensagens.length === 0 && <p className="vazio">Nenhuma mensagem ainda.</p>}
        {lead?.mensagens.map((m, i) => {
          const dia = rotuloDoDia(m.createdAt);
          const anterior = lead.mensagens[i - 1];
          const novoDia = !anterior || rotuloDoDia(anterior.createdAt) !== dia;
          return (
            <Fragment key={m.id}>
              {novoDia && (
                <p className="separador-dia">
                  <span>{dia}</span>
                </p>
              )}
              <Balao mensagem={m} />
            </Fragment>
          );
        })}
        {resumo.precisaDeVoce && resumo.esperandoDesde && (
          <p className="esperando">Esperando resposta {desde(resumo.esperandoDesde)}</p>
        )}
        <div ref={fim} />
      </div>

      <Compositor
        ref={compositor}
        conversaId={lead?.conversa?.id ?? null}
        nomeContato={nome ?? null}
        dica={comHumano ? "Escreva sua mensagem" : "Escrever aqui pausa a IA nesta conversa"}
        aoEnviado={aoEnviado}
        aoErro={setErro}
      />
    </div>
  );
}
