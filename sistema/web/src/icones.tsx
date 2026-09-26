/**
 * Ícones do CRM.
 *
 * Desenhados aqui, não emprestados de biblioteca nem substituídos por emoji:
 * um traço só (1.5), grade de 24, extremidades arredondadas, sem preenchimento.
 * Herdam `currentColor`, então a cor vem sempre do contexto — nunca há um ícone
 * com cor própria brigando com o texto ao lado.
 */

interface Props {
  tamanho?: number;
  className?: string;
}

function Base({
  tamanho = 18,
  className,
  children,
}: Props & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconePainel = (p: Props) => (
  <Base {...p}>
    <path d="M4 13.5 11 6l4 4 5-5.5" />
    <path d="M4 19h16" />
  </Base>
);

export const IconeFunil = (p: Props) => (
  <Base {...p}>
    <rect x="3" y="4" width="5.2" height="16" rx="1.4" />
    <rect x="10.4" y="4" width="5.2" height="11" rx="1.4" />
    <rect x="17.8" y="4" width="3.2" height="7" rx="1.4" />
  </Base>
);

export const IconeContatos = (p: Props) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19.5c.6-3 2.9-4.7 5.5-4.7s4.9 1.7 5.5 4.7" />
    <path d="M16.5 5.4a3.2 3.2 0 0 1 0 5.6" />
    <path d="M18 14.9c2 .5 3.4 2.1 3.8 4.6" />
  </Base>
);

export const IconeAgenda = (p: Props) => (
  <Base {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8.5 3.5v3M15.5 3.5v3" />
    <path d="M8 14.5h3" />
  </Base>
);

export const IconeConexao = (p: Props) => (
  <Base {...p}>
    <path d="M4.5 12a7.5 7.5 0 0 1 15 0v4.5a2.5 2.5 0 0 1-2.5 2.5h-4" />
    <rect x="2.5" y="10.5" width="4" height="6" rx="1.6" />
    <rect x="17.5" y="10.5" width="4" height="6" rx="1.6" />
  </Base>
);

export const IconeSair = (p: Props) => (
  <Base {...p}>
    <path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14" />
    <path d="M17 8.5 20.5 12 17 15.5M20 12H10" />
  </Base>
);

export const IconeBusca = (p: Props) => (
  <Base {...p}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 4.5 4.5" />
  </Base>
);

export const IconeMais = (p: Props) => (
  <Base {...p}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Base>
);

export const IconeBaixar = (p: Props) => (
  <Base {...p}>
    <path d="M12 4v10.5M8 11l4 3.5 4-3.5" />
    <path d="M4.5 17.5v1A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-1" />
  </Base>
);

export const IconeSubir = (p: Props) => (
  <Base {...p}>
    <path d="M12 20V9.5M8 13l4-3.5 4 3.5" />
    <path d="M4.5 6.5v-1A1.5 1.5 0 0 1 6 4h12a1.5 1.5 0 0 1 1.5 1.5v1" />
  </Base>
);

export const IconeRelogio = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.5V12l3 1.8" />
  </Base>
);

export const IconeAlerta = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4.5M12 15.8v.2" />
  </Base>
);

export const IconePessoa = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="8.5" r="3.4" />
    <path d="M5.5 19.5c.7-3.3 3.3-5.1 6.5-5.1s5.8 1.8 6.5 5.1" />
  </Base>
);

export const IconeConversa = (p: Props) => (
  <Base {...p}>
    <path d="M20 12.5c0 3.6-3.6 6.5-8 6.5a9.7 9.7 0 0 1-2.7-.4L4.5 20l1.2-3.3A6.1 6.1 0 0 1 4 12.5C4 8.9 7.6 6 12 6s8 2.9 8 6.5Z" />
  </Base>
);

export const IconeBloqueio = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="m6.6 6.6 10.8 10.8" />
  </Base>
);

export const IconeLixeira = (p: Props) => (
  <Base {...p}>
    <path d="M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
    <path d="M6.5 7v11.3A1.7 1.7 0 0 0 8.2 20h7.6a1.7 1.7 0 0 0 1.7-1.7V7" />
  </Base>
);

export const IconeLapis = (p: Props) => (
  <Base {...p}>
    <path d="M15.6 4.9a1.9 1.9 0 0 1 2.7 2.7L8.6 17.3l-3.6.9.9-3.6Z" />
  </Base>
);

export const IconeTendencia = (p: Props) => (
  <Base {...p}>
    <path d="M4 16.5 9.5 11l3.5 3.3L20 7.5" />
    <path d="M15.5 7.5H20V12" />
  </Base>
);

export const IconeCheck = (p: Props) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Base>
);

export const IconeMicrofone = (p: Props) => (
  <Base {...p}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
  </Base>
);

export const IconeClipe = (p: Props) => (
  <Base {...p}>
    <path d="m19 11.3-6.9 6.9a4.4 4.4 0 0 1-6.3-6.3l7.3-7.3a2.9 2.9 0 0 1 4.2 4.2l-7.2 7.2a1.5 1.5 0 0 1-2.1-2.1l6.6-6.6" />
  </Base>
);

export const IconeEmoji = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 14a4.2 4.2 0 0 0 7 0" />
    <path d="M9.3 9.6v.4M14.7 9.6v.4" />
  </Base>
);

export const IconeEnviar = (p: Props) => (
  <Base {...p}>
    <path d="M5 12 3.8 5.2a.8.8 0 0 1 1.1-.9l14.6 7a.8.8 0 0 1 0 1.4l-14.6 7a.8.8 0 0 1-1.1-.9Z" />
    <path d="M5 12h6.5" />
  </Base>
);

export const IconePlay = (p: Props) => (
  <Base {...p}>
    <path d="M8 5.8v12.4a.8.8 0 0 0 1.2.7l9.9-6.2a.8.8 0 0 0 0-1.4L9.2 5.1a.8.8 0 0 0-1.2.7Z" />
  </Base>
);

export const IconePausa = (p: Props) => (
  <Base {...p}>
    <path d="M9 5.5v13M15 5.5v13" />
  </Base>
);

export const IconeDocumento = (p: Props) => (
  <Base {...p}>
    <path d="M13.5 3.5H7.2A1.7 1.7 0 0 0 5.5 5.2v13.6a1.7 1.7 0 0 0 1.7 1.7h9.6a1.7 1.7 0 0 0 1.7-1.7V8.5Z" />
    <path d="M13.5 3.5v5h5M9 13h6M9 16.5h4" />
  </Base>
);

export const IconeImagem = (p: Props) => (
  <Base {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="9.5" r="1.5" />
    <path d="m20.5 15-4.6-4.6a1 1 0 0 0-1.4 0L6 19" />
  </Base>
);

export const IconeFechar = (p: Props) => (
  <Base {...p}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </Base>
);

export const IconeRaio = (p: Props) => (
  <Base {...p}>
    <path d="M13.5 3.5 5.5 13h6l-1 7.5 8-9.5h-6Z" />
  </Base>
);

/** Seta para a direita; com a classe "virada", aponta para a esquerda. */
export const IconeSeta = (p: Props) => (
  <Base {...p}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </Base>
);

export const IconeOlho = (p: Props) => (
  <Base {...p}>
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3.2" />
  </Base>
);

export const IconeOlhoFechado = (p: Props) => (
  <Base {...p}>
    <path d="M3 4.5l18 15" />
    <path d="M10.2 6.1A9.6 9.6 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-3.2 3.9" />
    <path d="M6.3 8.1A17 17 0 0 0 2.5 12S6 18.2 12 18.2a9.7 9.7 0 0 0 3.6-.7" />
    <path d="M9.9 10.2a3.2 3.2 0 0 0 4.3 4.5" />
  </Base>
);

export const IconeTelefone = (p: Props) => (
  <Base {...p}>
    <path d="M6.6 3.8h2.6l1.4 3.8-1.9 1.3a10.4 10.4 0 0 0 5.4 5.4l1.3-1.9 3.8 1.4v2.6a2 2 0 0 1-2.2 2A15.4 15.4 0 0 1 4.6 6a2 2 0 0 1 2-2.2Z" />
  </Base>
);

export const IconeEtiqueta = (p: Props) => (
  <Base {...p}>
    <path d="M3.8 12.4V5.3a1.5 1.5 0 0 1 1.5-1.5h7.1l8 8a1.5 1.5 0 0 1 0 2.1l-7 7a1.5 1.5 0 0 1-2.1 0Z" />
    <circle cx="8.3" cy="8.3" r="1.3" />
  </Base>
);

/*
 * Estado da coluna do funil, como progressao: o circulo enche conforme a coluna
 * avanca no caminho. Ganho e perdido sao fim de caminho e tem icone proprio. Cor
 * vem do CSS da coluna, nunca do icone.
 */

/**
 * Progresso de 0 a 1. Zero e o circulo tracejado (nada aconteceu ainda); acima
 * disso, uma fatia cheia dentro do anel, comecando no topo e girando no sentido
 * do relogio.
 */
export function IconeProgresso({ fracao, ...p }: Props & { fracao: number }) {
  const f = Math.min(Math.max(fracao, 0), 0.999);
  if (f <= 0) {
    return (
      <Base {...p}>
        <circle cx="12" cy="12" r="7.5" strokeDasharray="2.6 2.6" />
      </Base>
    );
  }
  const raio = 4.5;
  const angulo = f * 2 * Math.PI;
  const x = 12 + raio * Math.sin(angulo);
  const y = 12 - raio * Math.cos(angulo);
  const grande = f > 0.5 ? 1 : 0;
  return (
    <Base {...p}>
      <circle cx="12" cy="12" r="7.5" />
      <path
        d={`M12 12 L12 ${12 - raio} A${raio} ${raio} 0 ${grande} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`}
        fill="currentColor"
        stroke="none"
      />
    </Base>
  );
}

/* Fim de caminho: circulo cheio com o sinal em branco, como na referencia. */
export const IconeEstagioGanho = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" fill="currentColor" />
    <path d="m8.8 12.2 2.2 2.2 4.2-4.6" stroke="#fff" strokeWidth={2} />
  </Base>
);

export const IconeEstagioPerdido = (p: Props) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" fill="currentColor" />
    <path d="m9.5 9.5 5 5M14.5 9.5l-5 5" stroke="#fff" strokeWidth={2} />
  </Base>
);

/** Abrir e recolher a barra lateral. */
export const IconeLateral = (p: Props) => (
  <Base {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M9.5 4.5v15" />
  </Base>
);
