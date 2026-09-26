import { useEffect, useMemo, useRef, useState } from "react";
import { IconeCheck, IconeMais } from "./icones";
import { primeiraMaiuscula } from "./editavel";

/**
 * Etiquetas coloridas e o seletor de etiquetas, no desenho da referencia escolhida
 * pelo dono (25/09/2026).
 *
 * A cor sai do NOME da etiqueta, sempre a mesma: "convenio" e azul em todo card,
 * em toda tela, em todo computador. Cor sorteada ou por posicao mudaria quando o
 * vocabulario mudasse, e o olho deixaria de reconhecer. As oito cores sao as da
 * especificacao da referencia; o fundo e a cor a 24%, o texto e a tinta normal.
 */

const CORES = [
  "--etq-azul",
  "--etq-vermelho",
  "--etq-laranja",
  "--etq-verde",
  "--etq-petroleo",
  "--etq-roxo",
  "--etq-rosa",
  "--etq-amarelo",
];

export function corDaEtiqueta(nome: string): string {
  let soma = 0;
  const chave = normalizar(nome);
  for (let i = 0; i < chave.length; i++) soma = (soma * 31 + chave.charCodeAt(i)) % 100_000;
  return `var(${CORES[soma % CORES.length]})`;
}

export function Etiqueta({ nome, title }: { nome: string; title?: string }) {
  return (
    <span className="tag colorida" style={{ "--cor": corDaEtiqueta(nome) } as React.CSSProperties} title={title}>
      {primeiraMaiuscula(nome)}
    </span>
  );
}

/**
 * As etiquetas do contato, e ao clicar, a caixa de escolher: busca, a lista inteira
 * com um visto nas marcadas, e criar uma nova quando o texto nao existe.
 *
 * Etiqueta criada aqui fica so neste contato e fora do vocabulario da IA — a regra
 * de 06/09/2026: a IA nao apaga o que ela nem sabe que existe.
 */
export function EscolherEtiquetas({
  marcadas,
  vocabulario,
  aoMudar,
}: {
  marcadas: string[];
  vocabulario: string[];
  aoMudar: (etiquetas: string[]) => void;
}) {
  const [aberta, setAberta] = useState(false);
  const [busca, setBusca] = useState("");
  const [destaque, setDestaque] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);

  // Todas as opcoes: o vocabulario do negocio e as etiquetas escritas a mao.
  const todas = useMemo(() => {
    const vistas = new Set(vocabulario.map(normalizar));
    return [...vocabulario, ...marcadas.filter((m) => !vistas.has(normalizar(m)))];
  }, [vocabulario, marcadas]);

  const termo = normalizar(busca.trim());
  const opcoes = termo ? todas.filter((t) => normalizar(t).includes(termo)) : todas;
  const podeCriar = Boolean(termo) && !todas.some((t) => normalizar(t) === termo);
  const totalDeLinhas = opcoes.length + (podeCriar ? 1 : 0);

  useEffect(() => {
    if (!aberta) return;
    campo.current?.focus();
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberta(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberta]);

  useEffect(() => setDestaque(0), [busca]);

  const alternar = (etiqueta: string) => {
    const ja = marcadas.some((m) => normalizar(m) === normalizar(etiqueta));
    aoMudar(ja ? marcadas.filter((m) => normalizar(m) !== normalizar(etiqueta)) : [...marcadas, etiqueta]);
  };

  const criar = () => {
    const nova = busca.trim();
    if (!nova) return;
    aoMudar([...marcadas, nova]);
    setBusca("");
  };

  const escolherDestaque = () => {
    if (destaque < opcoes.length) alternar(opcoes[destaque]!);
    else if (podeCriar) criar();
  };

  return (
    <div className="escolher-etiquetas" ref={caixa}>
      <button
        type="button"
        className="etiquetas-atuais"
        onClick={() => setAberta((a) => !a)}
        aria-expanded={aberta}
        aria-haspopup="listbox"
      >
        {marcadas.length ? (
          marcadas.map((m) => <Etiqueta key={m} nome={m} />)
        ) : (
          <span className="sem-etiqueta">
            <IconeMais tamanho={13} />
            Adicionar etiqueta
          </span>
        )}
      </button>

      {aberta && (
        <div className="menu-etiquetas">
          <input
            ref={campo}
            className="campo"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar ou criar etiqueta"
            aria-label="Buscar ou criar etiqueta"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // Fecha so a caixa, nao a janela do lead que esta atras.
                e.stopPropagation();
                setAberta(false);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setDestaque((d) => Math.min(d + 1, Math.max(totalDeLinhas - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setDestaque((d) => Math.max(d - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                escolherDestaque();
              }
            }}
          />

          <ul role="listbox" aria-multiselectable="true">
            {opcoes.map((opcao, i) => {
              const marcada = marcadas.some((m) => normalizar(m) === normalizar(opcao));
              return (
                <li key={opcao}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={marcada}
                    className={i === destaque ? "destacada" : undefined}
                    onMouseEnter={() => setDestaque(i)}
                    onClick={() => alternar(opcao)}
                  >
                    <Etiqueta nome={opcao} />
                    {marcada && <IconeCheck tamanho={16} className="visto" />}
                  </button>
                </li>
              );
            })}
            {podeCriar && (
              <li>
                <button
                  type="button"
                  className={destaque === opcoes.length ? "destacada criar" : "criar"}
                  onMouseEnter={() => setDestaque(opcoes.length)}
                  onClick={criar}
                >
                  <IconeMais tamanho={14} />
                  Criar <Etiqueta nome={busca.trim()} />
                </button>
              </li>
            )}
            {!opcoes.length && !podeCriar && <li className="vazio">Nenhuma etiqueta ainda.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
