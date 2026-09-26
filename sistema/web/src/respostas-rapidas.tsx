import { useEffect, useRef, useState } from "react";
import { ErroApi, api } from "./api";
import type { RespostaRapida } from "./api";
import { IconeLapis, IconeLixeira, IconeMais } from "./icones";
import { Modal } from "./modal";
import { useConfirmar } from "./confirmar";
import { preencherResposta } from "./respostas";

/**
 * Respostas rápidas na caixa de entrada: "/" no começo da mensagem abre a lista.
 *
 * O que se procura primeiro é o atalho ("/end" acha "/endereco"); depois o texto,
 * para quem lembra do conteúdo e não do nome.
 */

export function filtrarRespostas(lista: RespostaRapida[], consulta: string): RespostaRapida[] {
  const q = consulta.toLowerCase();
  if (!q) return lista;
  const peloComeco = lista.filter((r) => r.atalho.startsWith(q));
  const peloResto = lista.filter(
    (r) => !r.atalho.startsWith(q) && (r.atalho.includes(q) || r.texto.toLowerCase().includes(q)),
  );
  return [...peloComeco, ...peloResto];
}

export function MenuRespostas({
  respostas,
  destaque,
  nomeContato,
  aoEscolher,
  aoDestacar,
  aoEditar,
}: {
  respostas: RespostaRapida[] | null;
  destaque: number;
  nomeContato: string | null;
  aoEscolher: (r: RespostaRapida) => void;
  aoDestacar: (i: number) => void;
  aoEditar: () => void;
}) {
  const lista = useRef<HTMLUListElement>(null);

  // A setinha do teclado leva o item destacado junto, mesmo fora da área visível.
  useEffect(() => {
    lista.current?.children[destaque]?.scrollIntoView({ block: "nearest" });
  }, [destaque]);

  return (
    <div className="menu-respostas" role="dialog" aria-label="Respostas rápidas">
      {respostas === null ? (
        <p className="vazio">Carregando</p>
      ) : respostas.length === 0 ? (
        <p className="vazio">Nenhuma resposta encontrada.</p>
      ) : (
        <ul ref={lista} role="listbox" aria-label="Respostas rápidas">
          {respostas.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === destaque}>
              <button
                type="button"
                // mousedown: escolher antes que a caixa de texto perca o foco.
                onMouseDown={(e) => {
                  e.preventDefault();
                  aoEscolher(r);
                }}
                onMouseEnter={() => aoDestacar(i)}
              >
                <span className="atalho">/{r.atalho}</span>
                <span className="previa">{preencherResposta(r.texto, nomeContato)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rodape-menu">
        <span className="dica">
          <kbd>↑</kbd>
          <kbd>↓</kbd> escolhem, <kbd>Enter</kbd> usa
        </span>
        <button
          type="button"
          className="botao discreto"
          onMouseDown={(e) => {
            e.preventDefault();
            aoEditar();
          }}
        >
          Editar respostas
        </button>
      </div>
    </div>
  );
}

/** Criar, editar e apagar. Abre por cima da conversa, sem sair dela. */
export function GerenciarRespostas({
  aoFechar,
  aoMudar,
}: {
  aoFechar: () => void;
  aoMudar: (lista: RespostaRapida[]) => void;
}) {
  const [lista, setLista] = useState<RespostaRapida[] | null>(null);
  const [editando, setEditando] = useState<Partial<RespostaRapida> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const confirmar = useConfirmar();

  const carregar = async () => {
    try {
      const nova = await api.respostasRapidas();
      setLista(nova);
      aoMudar(nova);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "As respostas não carregaram. Feche e abra de novo.");
    }
  };

  useEffect(() => {
    void carregar();
  }, []);

  const apagar = async (r: RespostaRapida) => {
    const pergunta = await confirmar({
      titulo: `Apagar a resposta /${r.atalho}?`,
      acao: "Apagar resposta",
      perigoso: true,
    });
    if (!pergunta.ok) return;
    try {
      await api.apagarRespostaRapida(r.id);
      await carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não deu para apagar. Tente de novo.");
    }
  };

  return (
    <Modal titulo="Respostas rápidas" aoFechar={aoFechar}>
      <div className="gerenciar-respostas">
        {erro && <div className="aviso erro">{erro}</div>}

        {editando ? (
          <FormularioResposta
            inicial={editando}
            aoCancelar={() => setEditando(null)}
            aoSalvar={async () => {
              setEditando(null);
              await carregar();
            }}
          />
        ) : (
          <button type="button" className="botao" onClick={() => setEditando({})}>
            <IconeMais tamanho={16} className="icone" />
            Nova resposta
          </button>
        )}

        {lista?.length === 0 && !editando && (
          <p className="vazio">
            Guarde aqui o que você escreve todo dia: endereço, preço, documentos. Depois é só
            digitar / na conversa.
          </p>
        )}

        <ul className="lista-respostas">
          {lista?.map((r) => (
            <li key={r.id}>
              <div className="resposta-texto">
                <span className="atalho">/{r.atalho}</span>
                <p>{r.texto}</p>
              </div>
              <div className="acoes-resposta">
                <button
                  type="button"
                  className="botao-icone"
                  onClick={() => setEditando(r)}
                  aria-label={`Editar /${r.atalho}`}
                  title="Editar"
                >
                  <IconeLapis tamanho={17} />
                </button>
                <button
                  type="button"
                  className="botao-icone perigoso"
                  onClick={() => void apagar(r)}
                  aria-label={`Apagar /${r.atalho}`}
                  title="Apagar"
                >
                  <IconeLixeira tamanho={17} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function FormularioResposta({
  inicial,
  aoCancelar,
  aoSalvar,
}: {
  inicial: Partial<RespostaRapida>;
  aoCancelar: () => void;
  aoSalvar: () => Promise<void>;
}) {
  const [atalho, setAtalho] = useState(inicial.atalho ?? "");
  const [texto, setTexto] = useState(inicial.texto ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    // No React o evento sobe pela árvore de componentes, mesmo saindo por portal.
    e.stopPropagation();
    setSalvando(true);
    setErro(null);
    try {
      await api.salvarRespostaRapida({ id: inicial.id, atalho, texto });
      await aoSalvar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : "Não deu para salvar. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form className="formulario formulario-resposta" onSubmit={salvar}>
      {erro && <div className="aviso erro">{erro}</div>}
      <label>
        Atalho
        <span className="campo-atalho">
          <span aria-hidden="true">/</span>
          <input
            className="campo"
            value={atalho}
            onChange={(e) => setAtalho(e.target.value.replace(/^\/+/, ""))}
            placeholder="endereco"
            maxLength={30}
            required
            autoFocus
          />
        </span>
      </label>
      <label>
        Texto
        <textarea
          className="campo"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={4}
          placeholder="Oi {nome}, nosso endereço é…"
          required
        />
        <span className="ajuda">{"{nome}"} vira o primeiro nome da pessoa.</span>
      </label>
      <div className="acoes">
        <button type="submit" className="botao" disabled={salvando}>
          {inicial.id ? "Salvar alterações" : "Criar resposta"}
        </button>
        <button type="button" className="botao secundario" onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
