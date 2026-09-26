import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Pergunta antes de agir, no desenho do CRM.
 *
 * Substitui o window.confirm e o window.prompt do navegador: aquela caixa cinza com
 * "localhost:3000 diz" parece erro do sistema, tem cara diferente em cada navegador e
 * não deixa escrever o botão ("OK" não diz o que vai acontecer).
 *
 * Uso: const confirmar = useConfirmar();
 *      const r = await confirmar({ titulo, acao: "Remarcar" });
 *      if (!r.ok) return;
 */

export interface PedidoConfirmacao {
  titulo: string;
  mensagem?: React.ReactNode;
  /** O texto do botão diz o que acontece: "Remarcar", "Apagar contato". Nunca "OK". */
  acao: string;
  /** Ação que destrói algo: botão vermelho. */
  perigoso?: boolean;
  /** Pede um texto junto (ex.: motivo do cancelamento). */
  campo?: { rotulo: string; dica?: string };
}

type Resposta = { ok: boolean; texto: string };

const Contexto = createContext<(p: PedidoConfirmacao) => Promise<Resposta>>(async () => ({
  ok: false,
  texto: "",
}));

export const useConfirmar = () => useContext(Contexto);

export function ProvedorConfirmacao({ children }: { children: React.ReactNode }) {
  const [pedido, setPedido] = useState<PedidoConfirmacao | null>(null);
  const [texto, setTexto] = useState("");
  const responder = useRef<((r: Resposta) => void) | null>(null);

  const confirmar = useCallback(
    (p: PedidoConfirmacao) =>
      new Promise<Resposta>((resolver) => {
        responder.current?.({ ok: false, texto: "" });
        responder.current = resolver;
        setTexto("");
        setPedido(p);
      }),
    [],
  );

  const fechar = (ok: boolean) => {
    responder.current?.({ ok, texto: texto.trim() });
    responder.current = null;
    setPedido(null);
  };

  return (
    <Contexto.Provider value={confirmar}>
      {children}
      {pedido && (
        <JanelaConfirmacao
          pedido={pedido}
          texto={texto}
          aoDigitar={setTexto}
          aoConfirmar={() => fechar(true)}
          aoCancelar={() => fechar(false)}
        />
      )}
    </Contexto.Provider>
  );
}

function JanelaConfirmacao({
  pedido,
  texto,
  aoDigitar,
  aoConfirmar,
  aoCancelar,
}: {
  pedido: PedidoConfirmacao;
  texto: string;
  aoDigitar: (t: string) => void;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  const botao = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (pedido.campo ? campo.current : botao.current)?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoCancelar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [pedido, aoCancelar]);

  return createPortal(
    <div
      className="cortina centralizada"
      onMouseDown={(e) => e.target === e.currentTarget && aoCancelar()}
    >
      <div className="janela janela-confirmacao" role="alertdialog" aria-modal="true" aria-labelledby="confirmacao-titulo">
        <div className="corpo">
          <h2 id="confirmacao-titulo">{pedido.titulo}</h2>
          {pedido.mensagem && <div className="mensagem">{pedido.mensagem}</div>}
          {pedido.campo && (
            <label className="campo-confirmacao">
              {pedido.campo.rotulo}
              <textarea
                ref={campo}
                className="campo"
                rows={2}
                value={texto}
                placeholder={pedido.campo.dica}
                onChange={(e) => aoDigitar(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    aoConfirmar();
                  }
                }}
              />
            </label>
          )}
          <div className="botoes-confirmacao">
            <button type="button" className="botao secundario" onClick={aoCancelar}>
              Voltar
            </button>
            <button
              ref={botao}
              type="button"
              className={`botao${pedido.perigoso ? " perigo" : ""}`}
              onClick={aoConfirmar}
            >
              {pedido.acao}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
