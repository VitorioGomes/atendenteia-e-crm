import { useCallback, useEffect, useRef, useState } from "react";
import { ErroApi, api } from "../api";
import type { Cartao, Estagio } from "../api";
import { desde, hora, moeda, nomeExibido } from "../formato";
import { useJaVistos } from "../animacao";
import {
  IconeBusca,
  IconeEstagioGanho,
  IconeEstagioPerdido,
  IconeProgresso,
  IconeRelogio,
} from "../icones";
import { PainelLead, estagiosParaJanela } from "./PainelLead";
import { Etiqueta } from "../etiquetas";
import { SeloResponsavel } from "../responsavel";
import { primeiraMaiuscula } from "../editavel";

/** De quanto em quanto tempo a tela se atualiza sozinha. */
const INTERVALO_MS = 10_000;

export function Funil({
  etiquetas,
  rotulosDeCampos,
  nomeDaIa = "Atendente",
  nomeDaPessoa = "Você",
  aoIrParaConversa,
}: {
  etiquetas: string[];
  rotulosDeCampos?: Record<string, string>;
  nomeDaIa?: string;
  nomeDaPessoa?: string;
  /** "Abrir conversa", na gaveta do lead: sai do funil e vai para Conversas. */
  aoIrParaConversa?: (conversaId: string, telefone: string) => void;
}) {
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [soComVoce, setSoComVoce] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [leadAberto, setLeadAberto] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [colunaAlvo, setColunaAlvo] = useState<string | null>(null);
  const [recemMovido, setRecemMovido] = useState<string | null>(null);
  const relogioDoPouso = useRef<number | undefined>(undefined);

  /**
   * Marca o card que acabou de mudar de coluna.
   *
   * Ele reaparece noutro lugar da tela; sem um sinal, o olho perde de vista o
   * que foi movido. A marca dura o suficiente para a animacao de pouso terminar
   * e sai sozinha — se ficasse, seria mais um estado permanente na interface.
   */
  const marcarPouso = useCallback((id: string) => {
    window.clearTimeout(relogioDoPouso.current);
    setRecemMovido(id);
    relogioDoPouso.current = window.setTimeout(() => setRecemMovido(null), 1000);
  }, []);

  useEffect(() => () => window.clearTimeout(relogioDoPouso.current), []);

  const carregar = useCallback(async () => {
    try {
      const funil = await api.funil();
      setEstagios(funil.estagios);
      setAtualizadoEm(new Date().toISOString());
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "O funil não carregou. Recarregue a página.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
    const relogio = setInterval(() => void carregar(), INTERVALO_MS);
    return () => clearInterval(relogio);
  }, [carregar]);

  const total = estagios.reduce((soma, e) => soma + e.total, 0);
  // "Com voce": conversas que a IA passou para a equipe, ou que alguem assumiu (ou
  // pausou respondendo pelo celular). E a mesma regra do selo azul do responsavel.
  const estaComVoce = (c: Cartao) => c.modo === "HUMAN" || c.pausado;
  const comVoce = estagios.reduce((soma, e) => soma + e.cards.filter(estaComVoce).length, 0);

  // Busca e filtro rodam na tela: os cards ja estao todos aqui, e a lista se
  // atualiza sozinha a cada 10s sem perder o que a pessoa digitou.
  const termo = normalizar(busca.trim());
  const filtrando = Boolean(termo) || soComVoce;
  const visivel = (c: Cartao) =>
    (!soComVoce || estaComVoce(c)) &&
    (!termo ||
      [c.nome, c.titulo, c.telefone, c.telefoneFormatado, c.resumo, ...c.tags].some((campo) =>
        normalizar(campo ?? "").includes(termo),
      ));

  // Icone de coluna como progressao, nao como enfeite: a primeira coluna aberta e
  // um circulo tracejado (nada aconteceu ainda) e cada coluna seguinte enche mais.
  // Antes "Qualificando" e "Qualificado" tinham o mesmo icone, que entao nao
  // distinguia nada. Ganho e perdido tem icone proprio: sao fim de caminho.
  const abertas = estagios.filter((e) => !e.ganho && !e.perdido);
  const progresso = new Map(abertas.map((e, i) => [e.id, i / abertas.length]));

  // A tela recarrega sozinha a cada 10s. Sem isto, todo card reanimaria a cada
  // ciclo e o funil ficaria piscando — animação vira defeito.
  const jaVisto = useJaVistos(estagios.flatMap((e) => e.cards.map((c) => c.id)));

  /**
   * Move o card de coluna.
   *
   * A tela muda na hora e so depois confirma com o servidor: arrastar e soltar
   * que "pensa" antes de mover parece quebrado. Se o servidor recusar, recarrega
   * e o card volta pro lugar.
   */
  const mover = async (cartaoId: string, estagioDestinoId: string) => {
    const origem = estagios.find((e) => e.cards.some((c) => c.id === cartaoId));
    if (!origem || origem.id === estagioDestinoId) return;

    const cartao = origem.cards.find((c) => c.id === cartaoId);
    if (!cartao) return;

    marcarPouso(cartaoId);

    setEstagios((anterior) =>
      anterior.map((estagio) => {
        if (estagio.id === origem.id) {
          return {
            ...estagio,
            total: Math.max(0, estagio.total - 1),
            cards: estagio.cards.filter((c) => c.id !== cartaoId),
          };
        }
        if (estagio.id === estagioDestinoId) {
          return {
            ...estagio,
            total: estagio.total + 1,
            cards: [{ ...cartao, estagioId: estagioDestinoId }, ...estagio.cards],
          };
        }
        return estagio;
      }),
    );

    try {
      await api.moverLead(cartaoId, estagioDestinoId);
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "O lead não foi movido. Tente de novo.");
    } finally {
      await carregar();
    }
  };

  return (
    <div className="tela-funil">
      <div className="cabecalho">
        <h1>
          Funil
          {!carregando && <span className="contagem-titulo">{total}</span>}
        </h1>
      </div>

      <div className="barra-funil">
        <label className="barra-busca compacta">
          <IconeBusca tamanho={16} className="icone" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, telefone ou etiqueta"
            aria-label="Buscar no funil"
          />
        </label>

        {/* O filtro mostra o que a IA passou para voce (pedido do dono, 25/09/2026).
            Quem esta esperando uma pessoa ja se ve pelo contorno laranja no quadro e
            na aba "Precisam de voce" de Conversas. */}
        <div className="alternador filtro-funil" role="tablist" aria-label="Filtrar o funil">
          <button
            type="button"
            role="tab"
            aria-selected={!soComVoce}
            onClick={() => setSoComVoce(false)}
          >
            Todos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={soComVoce}
            onClick={() => setSoComVoce(true)}
          >
            Com você
            {comVoce > 0 && <span className="contagem info">{comVoce}</span>}
          </button>
        </div>
      </div>

      {erro && <div className="aviso erro">{erro}</div>}

      {!carregando && total === 0 && !erro && (
        <div className="aviso atencao">
          <strong>Nenhum lead ainda.</strong> Mande uma mensagem para o número conectado de outro
          celular: o contato aparece aqui em poucos segundos.
        </div>
      )}

      <div className="funil">
        {estagios.map((estagio) => {
          const recebeu = estagio.cards.some((c) => c.id === recemMovido);
          const cards = estagio.cards.filter(visivel);
          const icone = estagio.ganho ? (
            <IconeEstagioGanho tamanho={16} className="icone-estagio" />
          ) : estagio.perdido ? (
            <IconeEstagioPerdido tamanho={16} className="icone-estagio" />
          ) : (
            <IconeProgresso
              tamanho={16}
              className="icone-estagio"
              fracao={progresso.get(estagio.id) ?? 0}
            />
          );
          return (
            <section
              className={[
                "coluna",
                estagio.ganho ? "ganho" : "",
                estagio.perdido ? "perdido" : "",
                progresso.get(estagio.id) === 0 ? "inicio" : "",
                colunaAlvo === estagio.id ? "alvo" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={estagio.id}
              onDragOver={(evento) => {
                // Sem o preventDefault o navegador recusa o soltar.
                evento.preventDefault();
                if (colunaAlvo !== estagio.id) setColunaAlvo(estagio.id);
              }}
              onDragLeave={(evento) => {
                // Só apaga o destaque quando o ponteiro sai da coluna inteira,
                // não ao passar por cima de um card de dentro dela.
                if (!evento.currentTarget.contains(evento.relatedTarget as Node)) {
                  setColunaAlvo((atual) => (atual === estagio.id ? null : atual));
                }
              }}
              onDrop={(evento) => {
                evento.preventDefault();
                const cartaoId = evento.dataTransfer.getData("text/plain") || arrastando;
                setColunaAlvo(null);
                setArrastando(null);
                if (cartaoId) void mover(cartaoId, estagio.id);
              }}
            >
              <h2>
                {icone}
                <span className="nome-coluna">{estagio.nome}</span>
                <span className={`contagem${recebeu ? " pulou" : ""}`}>
                  {filtrando ? cards.length : estagio.total}
                </span>
              </h2>

              <div className="lista">
                {cards.map((cartao) => (
                  <CartaoLead
                    key={cartao.id}
                    cartao={cartao}
                    conhecido={jaVisto(cartao.id)}
                    aterrissou={cartao.id === recemMovido}
                    arrastando={arrastando === cartao.id}
                    aoArrastar={(ativo) => setArrastando(ativo ? cartao.id : null)}
                    aoAbrir={() => setLeadAberto(cartao.id)}
                  />
                ))}
                {cards.length === 0 && <p className="vazio">{filtrando ? "nada aqui" : "vazio"}</p>}
                {!filtrando && estagio.total > estagio.cards.length && (
                  <p className="vazio">
                    mostrando os {estagio.cards.length} mais recentes de {estagio.total}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <footer className="rodape-funil">
        <span>{total === 1 ? "1 lead" : `${total} leads`}</span>
        {atualizadoEm && <span>Atualizado às {hora(atualizadoEm)}</span>}
      </footer>

      {leadAberto && (
        <PainelLead
          id={leadAberto}
          estagios={estagiosParaJanela(estagios)}
          etiquetas={etiquetas}
          rotulosDeCampos={rotulosDeCampos}
          nomeDaIa={nomeDaIa}
          nomeDaPessoa={nomeDaPessoa}
          aoIrParaConversa={
            aoIrParaConversa &&
            ((conversaId) => {
              const cartao = estagios.flatMap((e) => e.cards).find((c) => c.id === leadAberto);
              aoIrParaConversa(conversaId, cartao?.telefone ?? "");
            })
          }
          aoFechar={() => {
            setLeadAberto(null);
            void carregar();
          }}
          aoMudar={async (idMovido) => {
            // Mover pelo seletor do painel merece o mesmo pouso do arrastar:
            // no celular esse e o unico jeito de mover.
            if (idMovido) marcarPouso(idMovido);
            await carregar();
          }}
        />
      )}
    </div>
  );
}

function CartaoLead({
  cartao,
  conhecido,
  aterrissou,
  arrastando,
  aoArrastar,
  aoAbrir,
}: {
  cartao: Cartao;
  conhecido: boolean;
  aterrissou: boolean;
  arrastando: boolean;
  aoArrastar: (ativo: boolean) => void;
  aoAbrir: () => void;
}) {
  const classes = [
    "cartao",
    conhecido ? "conhecido" : "",
    aterrissou ? "aterrissou" : "",
    cartao.aguardandoResposta ? "aguardando" : "",
    cartao.modo === "HUMAN" ? "humano" : "",
    arrastando ? "arrastando" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // "Sem resposta" e "Com voce" nao sao etiquetas, e ocupavam o lugar delas (achado
  // do dono, 25/09/2026). Cada um foi para onde a referencia ja tinha um lugar: quem
  // atende e o selo redondo do responsavel, e quem espera e o proprio tempo.
  const comVoce = cartao.modo === "HUMAN" || cartao.pausado;

  return (
    <button
      type="button"
      className={classes}
      onClick={aoAbrir}
      title="Arraste para outra coluna para mover o lead"
      draggable
      onDragStart={(evento) => {
        // O Firefox só inicia o arrasto se houver dado no dataTransfer.
        evento.dataTransfer.setData("text/plain", cartao.id);
        evento.dataTransfer.effectAllowed = "move";
        aoArrastar(true);
      }}
      onDragEnd={() => aoArrastar(false)}
    >
      {/* Como na referencia do dono: titulo, descricao e um rodape de selos. O
          telefone saiu do card: esta na gaveta, e vira o titulo quando nao ha nome. */}
      {/* O valor mora ao lado do nome, sempre no mesmo canto. No rodape ele ia para
          o lado ou para baixo conforme sobrava espaco (achado do dono, 25/09/2026). */}
      <div className="cabeca-cartao">
        <strong className="titulo-cartao">
          {nomeExibido(cartao.nome) || cartao.telefoneFormatado}
        </strong>
        {cartao.valor != null && <span className="valor-cartao">{moeda(cartao.valor)}</span>}
      </div>
      {/* Sem resumo da IA ainda, uma frase do sistema com o que ja se sabe ("Lead novo",
          "Qualificando: gestor de trafego"), mais apagada. Card vazio parecia quebrado. */}
      {cartao.resumo ? (
        <p className="resumo">{cartao.resumo}</p>
      ) : (
        cartao.resumoProvisorio && <p className="resumo provisorio">{cartao.resumoProvisorio}</p>
      )}

      <div className="rodape-cartao">
        <span className="selo-com-dica" title={comVoce ? "Atendendo: você" : "Atendendo: IA"}>
          <SeloResponsavel quem={comVoce ? "voce" : "ia"} />
        </span>
        {cartao.tags.length > 0 && (
          <>
            <Etiqueta nome={cartao.tags[0]!} title={cartao.tags[0]} />
            {/* Esperando, o tempo fica mais longo ("Esperando 4 min"); o "+N" sai
                para a etiqueta caber inteira. A janela mostra todas. */}
            {cartao.tags.length > 1 && !cartao.aguardandoResposta && (
              <span className="tag" title={cartao.tags.slice(1).join(", ")}>
                +{cartao.tags.length - 1}
              </span>
            )}
          </>
        )}
        <span
          className={`tempo-cartao${cartao.aguardandoResposta ? " esperando" : ""}`}
          title={cartao.aguardandoResposta ? "Mandou mensagem e ninguém respondeu" : "Último contato"}
        >
          <IconeRelogio tamanho={13} className="icone" />
          {cartao.aguardandoResposta
            ? // "Esperando 4 min": sem o "ha", cabe ao lado de uma etiqueta em 290px.
              `Esperando ${desde(cartao.ultimoContatoEm).replace(/^há /, "")}`
            : primeiraMaiuscula(desde(cartao.ultimoContatoEm))}
        </span>
      </div>
    </button>
  );
}

/** Busca sem acento e sem maiúscula: "jose" acha "José". */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
