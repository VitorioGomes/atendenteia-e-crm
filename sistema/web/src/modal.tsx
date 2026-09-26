import { useEffect } from "react";
import { createPortal } from "react-dom";
import { IconeFechar } from "./icones";

/**
 * Janela sobre a tela. Fecha no Esc, no clique fora e no botão.
 *
 * Vai direto para o <body>: aberta de dentro de um formulário, ela não pode virar
 * formulário dentro de formulário.
 */
export function Modal({
  titulo,
  aoFechar,
  children,
}: {
  titulo: string;
  aoFechar: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  return createPortal(
    <div className="cortina centralizada" onClick={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="janela">
        <header className="topo">
          <h2>{titulo}</h2>
          {/* O mesmo X da janela do lead. Era a palavra "fechar", em minuscula. */}
          <button type="button" className="fechar-gaveta" onClick={aoFechar} aria-label="Fechar" title="Fechar">
            <IconeFechar tamanho={18} />
          </button>
        </header>
        <div className="corpo">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
