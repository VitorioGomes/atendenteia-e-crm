import { useEffect, useRef, useState } from "react";
import { IconeCheck, IconePessoa } from "./icones";

/**
 * Quem esta atendendo o lead: a IA ou voce. No desenho da referencia do dono
 * (25/09/2026), e uma propriedade que se troca num menu, no lugar do antigo botao
 * "Assumir conversa". Trocar para voce pausa a IA nesta conversa; trocar para a IA
 * devolve a conversa a ela.
 *
 * Sao so duas opcoes de proposito: o sistema tem um atendimento humano, nao uma
 * equipe com varias pessoas (multi-atendente e v2).
 */

export type QuemAtende = "ia" | "voce";

export function SeloResponsavel({ quem, tamanho = 20 }: { quem: QuemAtende; tamanho?: number }) {
  return quem === "ia" ? (
    <span className="responsavel ia" style={{ width: tamanho, height: tamanho }} aria-hidden="true">
      IA
    </span>
  ) : (
    <span className="responsavel voce" style={{ width: tamanho, height: tamanho }} aria-hidden="true">
      <IconePessoa tamanho={Math.round(tamanho * 0.6)} />
    </span>
  );
}

export function EscolherResponsavel({
  quem,
  nomeDaIa,
  nomeDaPessoa,
  desativado,
  aoMudar,
}: {
  quem: QuemAtende;
  /** Nome da atendente, do negocio.json ("Marina"). */
  nomeDaIa: string;
  /** Nome de quem esta usando o CRM, ou "Você". */
  nomeDaPessoa: string;
  desativado?: boolean;
  aoMudar: (novo: QuemAtende) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Fecha so o menu, nao a janela do lead que esta atras.
        e.stopPropagation();
        setAberto(false);
      }
    };
    document.addEventListener("mousedown", fora);
    window.addEventListener("keydown", tecla, true);
    return () => {
      document.removeEventListener("mousedown", fora);
      window.removeEventListener("keydown", tecla, true);
    };
  }, [aberto]);

  const opcoes: { valor: QuemAtende; nome: string; detalhe: string }[] = [
    { valor: "ia", nome: nomeDaIa, detalhe: "IA" },
    { valor: "voce", nome: nomeDaPessoa, detalhe: "Você" },
  ];
  const atual = opcoes.find((o) => o.valor === quem)!;

  return (
    <div className="escolher-responsavel" ref={caixa}>
      <button
        type="button"
        className="responsavel-atual"
        onClick={() => setAberto((a) => !a)}
        disabled={desativado}
        aria-expanded={aberto}
        aria-haspopup="listbox"
      >
        <SeloResponsavel quem={quem} />
        <span>{atual.nome}</span>
      </button>

      {aberto && (
        <ul className="menu-responsavel" role="listbox" aria-label="Quem atende">
          {opcoes.map((opcao) => (
            <li key={opcao.valor}>
              <button
                type="button"
                role="option"
                aria-selected={opcao.valor === quem}
                onClick={() => {
                  setAberto(false);
                  if (opcao.valor !== quem) aoMudar(opcao.valor);
                }}
              >
                <SeloResponsavel quem={opcao.valor} tamanho={22} />
                <span className="nome">{opcao.nome}</span>
                <span className="detalhe">{opcao.detalhe}</span>
                {opcao.valor === quem && <IconeCheck tamanho={16} className="visto" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
