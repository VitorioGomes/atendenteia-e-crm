import { useEffect, useRef, useState } from "react";

/**
 * Texto que vira campo ao clicar, sem lapis nem botao de editar (pedido do dono,
 * 25/09/2026): clica, escreve, e sai. Enter ou clicar fora salva; Esc desiste.
 *
 * Mostra com a primeira letra maiuscula, mas edita o valor como esta guardado:
 * a maiuscula e so apresentacao, e o que a IA gravou nao e reescrito sem ninguem
 * mexer.
 */
export function TextoEditavel({
  valor,
  aoSalvar,
  vazio = "Clique para escrever",
  className,
  rotulo,
  exibir = primeiraMaiuscula,
  editar = primeiraMaiuscula,
}: {
  valor: string;
  aoSalvar: (novo: string) => void | Promise<void>;
  /** O que aparece quando nao ha valor. */
  vazio?: string;
  className?: string;
  /** Nome acessivel do campo ("Nome", "Procedimento de interesse"). */
  rotulo: string;
  /** Como o valor aparece quando nao esta sendo editado. */
  exibir?: (valor: string) => string;
  /**
   * Como o texto chega ao campo quando se clica. O campo abre igual ao que se via
   * (achado do dono, 25/09/2026: a letra "virava" minuscula no clique); o valor
   * guardado so muda se a pessoa editar de fato.
   */
  editar?: (valor: string) => string;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(valor);
  // O texto com que o campo abriu: sair sem mexer nao pode gravar nada, nem a
  // maiuscula que so estava na tela.
  const [inicial, setInicial] = useState(valor);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editando) {
      campo.current?.focus();
      campo.current?.select();
    }
  }, [editando]);

  const salvar = () => {
    setEditando(false);
    const novo = rascunho.trim();
    if (novo !== inicial.trim()) void aoSalvar(novo);
  };

  if (editando) {
    return (
      <input
        ref={campo}
        className={`texto-editavel editando ${className ?? ""}`}
        value={rascunho}
        aria-label={rotulo}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={salvar}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            salvar();
          } else if (e.key === "Escape") {
            // Desiste da edicao sem fechar a janela que esta atras.
            e.stopPropagation();
            setRascunho(valor);
            setEditando(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={`texto-editavel ${valor ? "" : "sem-valor"} ${className ?? ""}`}
      aria-label={`${rotulo}: ${valor || "vazio"}. Clique para editar`}
      onClick={() => {
        const texto = editar(valor);
        setInicial(texto);
        setRascunho(texto);
        setEditando(true);
      }}
    >
      {valor ? exibir(valor) : vazio}
    </button>
  );
}

/** "harmonização facial" vira "Harmonização facial". So apresentacao. */
export function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase("pt-BR") + texto.slice(1);
}
