/**
 * Conversa com o servidor.
 *
 * Toda mensagem de erro que sai daqui e lida pelo dono do negocio, entao ela
 * precisa fazer sentido pra quem nao e tecnico.
 */

export class ErroApi extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem);
  }
}

async function pedir<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  let resposta: Response;

  try {
    resposta = await fetch(caminho, {
      credentials: "same-origin",
      headers: opcoes.body ? { "Content-Type": "application/json" } : undefined,
      ...opcoes,
    });
  } catch {
    throw new ErroApi("Sem conexão com o servidor. Verifique sua internet.", 0);
  }

  if (resposta.status === 204) return undefined as T;

  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    /* resposta sem JSON */
  }

  if (!resposta.ok) {
    const mensagem =
      (corpo as { erro?: string } | null)?.erro ?? "Algo deu errado. Tente de novo.";
    throw new ErroApi(mensagem, resposta.status);
  }

  return corpo as T;
}

/** Para respostas que não são JSON, como o CSV da exportação. */
async function pedirTexto(caminho: string): Promise<string> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, { credentials: "same-origin" });
  } catch {
    throw new ErroApi("Sem conexão com o servidor. Verifique sua internet.", 0);
  }
  if (!resposta.ok) {
    throw new ErroApi("Não consegui gerar o arquivo. Tente de novo.", resposta.status);
  }
  return resposta.text();
}

// --------------------------------------------------------------------- tipos

export type Modo = "BOT" | "HUMAN" | "CLOSED";

export interface Cartao {
  id: string;
  estagioId: string;
  titulo: string;
  nome: string | null;
  telefone: string;
  telefoneFormatado: string;
  resumo: string | null;
  proximoPasso: string | null;
  valor: number | null;
  tags: string[];
  atualizadoEm: string;
  ultimoContatoEm: string | null;
  conversaId: string | null;
  modo: Modo;
  pausado: boolean;
  aguardandoResposta: boolean;
}

export interface Estagio {
  id: string;
  chave: string;
  nome: string;
  ganho: boolean;
  perdido: boolean;
  /** Estágio para onde o agendamento leva o card. */
  agendado?: boolean;
  /** Quantos cards existem no estágio (pode ser maior que `cards.length`). */
  total: number;
  cards: Cartao[];
}

export interface Mensagem {
  id: string;
  direction: "IN" | "OUT";
  author: "CONTACT" | "BOT" | "HUMAN" | "SYSTEM";
  kind: string;
  text: string | null;
  transcript: string | null;
  createdAt: string;
  /** Foto, áudio, vídeo ou documento guardado no sistema. Mensagem antiga não tem. */
  midia?: Midia | null;
}

export interface Midia {
  url: string;
  mime: string;
  nome: string | null;
  tamanho: number | null;
  /** Duração da mensagem de voz, para quando o navegador não sabe ler do arquivo. */
  segundos?: number | null;
}

export interface OpcoesArquivo {
  nome: string;
  tipo: string;
  legenda?: string;
  /** Áudio gravado no CRM: vai como mensagem de voz, não como arquivo. */
  voz?: { segundos: number; onda: number[] | null };
}

export interface Evento {
  id: string;
  type: string;
  body: string;
  author: string;
  createdAt: string;
}

export interface Agendamento {
  id: string;
  servico: string;
  quando: string;
  duracaoMin: number;
  status: "SCHEDULED" | "CONFIRMED" | "CANCELED" | "DONE" | "NOSHOW";
  observacao: string | null;
  dealId: string | null;
  nome: string | null;
  telefoneFormatado: string;
  telefone?: string;
  /** "ia" ou "humano": quem marcou. */
  criadoPor?: string;
  /** Já passou do horário e ninguém marcou se a pessoa veio. */
  semDesfecho?: boolean;
}

export type AbaAgenda = "proximos" | "passados" | "cancelados";

export interface ListaAgenda {
  aba: AbaAgenda;
  total: number;
  contagens: { proximos: number; passados: number; cancelados: number; semDesfecho: number };
  itens: Agendamento[];
}

export interface RespostaRapida {
  id: string;
  atalho: string;
  texto: string;
}

export interface Lead {
  id: string;
  titulo: string;
  estagio: { id: string; chave: string; nome: string };
  status: string;
  valor: number | null;
  resumo: string | null;
  proximoPasso: string | null;
  criadoEm: string;
  ultimoContatoEm: string | null;
  contato: {
    id: string;
    nome: string | null;
    pushName: string | null;
    telefone: string;
    telefoneFormatado: string;
    email: string | null;
    tags: string[];
    campos: Record<string, unknown>;
  };
  conversa: {
    id: string;
    modo: Modo;
    pausadoAte: string | null;
    motivoTransferencia: string | null;
  } | null;
  mensagens: Mensagem[];
  eventos: Evento[];
  agendamentos: Agendamento[];
}

export interface Resumo {
  novosHoje: number;
  aguardando: number;
  emAtendimentoHumano: number;
  agendadosHoje: number;
  /** Conversas esperando uma PESSOA (ver src/crm/atencao.ts no servidor). */
  precisamDeVoce: number;
}

export interface ConversaResumo {
  id: string;
  negocioId: string | null;
  estagio: string | null;
  nome: string | null;
  telefone: string;
  telefoneFormatado: string;
  modo: Modo;
  pausado: boolean;
  precisaDeVoce: boolean;
  esperandoDesde: string | null;
  ultimaMensagem: {
    texto: string;
    autor: Mensagem["author"];
    em: string;
  } | null;
}

export interface ListaConversas {
  total: number;
  mostrando: number;
  precisamDeVoce: number;
  /** Conversas com a equipe ou com a IA pausada: o filtro "Com você". */
  comVoce: number;
  conversas: ConversaResumo[];
}

export interface StatusWhatsapp {
  estado: string;
  conectado: boolean;
  descricao: string;
  /** Qual número está conectado. Nulo quando desconectado. */
  conta?: {
    telefone: string;
    telefoneFormatado: string;
    nome: string | null;
    foto: string | null;
    desde: string | null;
  } | null;
  atividade?: {
    recebidasHoje: number;
    respondidasHoje: number;
    ultimaRecebidaEm: string | null;
  } | null;
}

export interface Servico {
  nome: string;
  duracaoMin: number;
}

export interface Sessao {
  usuario: { email: string; nome: string | null; tema?: "claro" | "escuro" | "sistema" };
  negocio: {
    nome: string;
    atendente: string;
    agendaAtiva: boolean;
    servicos: Servico[];
    /** Vocabulário fechado de etiquetas, o mesmo que a IA recebe. */
    etiquetas: string[];
    /** Rótulo de exibição de cada campo coletado pela IA, vindo da configuração. */
    rotulosDeCampos?: Record<string, string>;
    /** Horário de funcionamento por dia ("seg": [["09:00", "19:00"]]). */
    horarios?: HorariosSemana;
  };
}

export type ChaveDia = "dom" | "seg" | "ter" | "qua" | "qui" | "sex" | "sab";
export type HorariosSemana = Partial<Record<ChaveDia, [string, string][]>>;

export interface PeriodoAgenda {
  agendamentos: Agendamento[];
  bloqueios: Bloqueio[];
}

export interface HorarioLivre {
  /** Formato AAAA-MM-DDTHH:MM — é o que volta para o servidor. */
  valor: string;
  /** "quinta-feira, 11/09 as 14:00" — é o que a pessoa lê. */
  rotulo: string;
}

export interface Bloqueio {
  id: string;
  inicio: string;
  fim: string;
  motivo: string | null;
}

export interface ContatoResumo {
  id: string;
  nome: string | null;
  telefone: string;
  telefoneFormatado: string;
  email: string | null;
  tags: string[];
  estagio: string | null;
  dealId: string | null;
  agendamentos: number;
  conversas: number;
  criadoEm: string;
}

export interface ListaContatos {
  total: number;
  pagina: number;
  porPagina: number;
  contatos: ContatoResumo[];
}

export interface ResultadoImportacao {
  ok: true;
  criados: number;
  atualizados: number;
  lidas: number;
  problemas: string[];
}

export interface Painel {
  contatos: { total: number; hoje: number; semana: number; mes: number };
  atencao: { aguardandoResposta: number; emAtendimentoHumano: number };
  funil: { nome: string; chave: string; total: number; ganho: boolean; perdido: boolean }[];
  autonomia: {
    conversas30: number;
    precisaramDeHumano: number;
    percentualResolvidoPelaIa: number | null;
  };
  mensagens: { recebidas: number; enviadasPelaIa: number; enviadasPorHumano: number };
  agenda: {
    proximos7Dias: number;
    marcadosPelaIa30: number;
    compareceu: number;
    faltou: number;
    percentualComparecimento: number | null;
  };
  serieNovosLeads: { dia: string; rotulo: string; quantidade: number }[];
  uso: {
    modelo: string;
    chamadas: number;
    tokensEntrada: number;
    tokensSaida: number;
    aproveitamentoCache: number | null;
  };
}

// ------------------------------------------------------------------- chamadas

const apiReal = {
  eu: () => pedir<Sessao>("/api/eu"),

  entrar: (email: string, senha: string) =>
    pedir<{ ok: true }>("/api/entrar", {
      method: "POST",
      body: JSON.stringify({ email, senha }),
    }),

  sair: () => pedir<{ ok: true }>("/api/sair", { method: "POST" }),

  resumo: () => pedir<Resumo>("/api/resumo"),

  funil: () => pedir<{ estagios: Estagio[] }>("/api/funil"),

  lead: (id: string) => pedir<Lead>(`/api/negocios/${id}`),

  moverLead: (id: string, estagioId: string) =>
    pedir<{ ok: true }>(`/api/negocios/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ estagioId }),
    }),

  /** Valor do negocio em reais; null apaga. */
  comentar: (id: string, texto: string) =>
    pedir<Evento>(`/api/negocios/${id}/comentarios`, {
      method: "POST",
      body: JSON.stringify({ texto }),
    }),

  apagarComentario: (id: string, eventoId: string) =>
    pedir<{ ok: true }>(`/api/negocios/${id}/comentarios/${eventoId}`, { method: "DELETE" }),

  atualizarValor: (id: string, valor: number | null) =>
    pedir<{ ok: true }>(`/api/negocios/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ valor }),
    }),

  assumirConversa: (id: string) =>
    pedir<{ ok: true }>(`/api/conversas/${id}/assumir`, { method: "POST" }),

  devolverConversa: (id: string) =>
    pedir<{ ok: true }>(`/api/conversas/${id}/devolver`, { method: "POST" }),

  enviarArquivo: (id: string, arquivo: Blob, opcoes: OpcoesArquivo) => {
    const consulta = new URLSearchParams({ nome: opcoes.nome, tipo: opcoes.tipo });
    if (opcoes.legenda) consulta.set("legenda", opcoes.legenda);
    if (opcoes.voz) {
      consulta.set("voz", "1");
      consulta.set("segundos", String(opcoes.voz.segundos));
      if (opcoes.voz.onda) consulta.set("onda", opcoes.voz.onda.join(","));
    }
    return pedir<{ ok: true }>(`/api/conversas/${id}/arquivos?${consulta}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: arquivo,
    });
  },

  enviarMensagem: (id: string, texto: string) =>
    pedir<{ ok: true }>(`/api/conversas/${id}/mensagens`, {
      method: "POST",
      body: JSON.stringify({ texto }),
    }),

  agenda: (aba: AbaAgenda = "proximos", busca = "") =>
    pedir<ListaAgenda>(`/api/agenda?${new URLSearchParams({ aba, busca })}`),

  agendaPeriodo: (de: Date, ate: Date) =>
    pedir<PeriodoAgenda>(
      `/api/agenda/periodo?${new URLSearchParams({ de: de.toISOString(), ate: ate.toISOString() })}`,
    ),

  atualizarPerfil: (dados: { nome?: string; tema?: "claro" | "escuro" | "sistema" }) =>
    pedir<{ ok: true }>("/api/eu", { method: "PATCH", body: JSON.stringify(dados) }),

  trocarSenha: (atual: string, nova: string) =>
    pedir<{ ok: true }>("/api/eu/senha", { method: "POST", body: JSON.stringify({ atual, nova }) }),

  respostasRapidas: () => pedir<RespostaRapida[]>("/api/respostas-rapidas"),

  salvarRespostaRapida: (dados: { id?: string; atalho: string; texto: string }) =>
    pedir<RespostaRapida>(
      dados.id ? `/api/respostas-rapidas/${dados.id}` : "/api/respostas-rapidas",
      {
        method: dados.id ? "PUT" : "POST",
        body: JSON.stringify({ atalho: dados.atalho, texto: dados.texto }),
      },
    ),

  apagarRespostaRapida: (id: string) =>
    pedir<void>(`/api/respostas-rapidas/${id}`, { method: "DELETE" }),

  atualizarAgendamento: (id: string, status: Agendamento["status"]) =>
    pedir<{ ok: true }>(`/api/agendamentos/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  horariosLivres: (opcoes: { dia?: string; servico?: string; ignorar?: string } = {}) => {
    const busca = new URLSearchParams();
    if (opcoes.dia) busca.set("dia", opcoes.dia);
    if (opcoes.servico) busca.set("servico", opcoes.servico);
    if (opcoes.ignorar) busca.set("ignorar", opcoes.ignorar);
    return pedir<HorarioLivre[]>(`/api/horarios-livres?${busca.toString()}`);
  },

  criarAgendamento: (dados: {
    telefone: string;
    nome?: string;
    servico: string;
    dataHora: string;
    observacao?: string;
  }) => pedir<{ ok: true; id: string }>("/api/agendamentos", {
    method: "POST",
    body: JSON.stringify(dados),
  }),

  remarcarAgendamento: (id: string, dataHora: string) =>
    pedir<{ ok: true }>(`/api/agendamentos/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ dataHora }),
    }),

  cancelarAgendamento: (id: string, motivo?: string) =>
    pedir<{ ok: true }>(`/api/agendamentos/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "CANCELED", motivo }),
    }),

  conversas: (filtro: "todas" | "voce" = "todas", busca = "") => {
    const parametros = new URLSearchParams({ filtro });
    if (busca) parametros.set("busca", busca);
    return pedir<ListaConversas>(`/api/conversas?${parametros.toString()}`);
  },

  contatos: (busca = "", pagina = 1) => {
    const parametros = new URLSearchParams({ pagina: String(pagina) });
    if (busca) parametros.set("busca", busca);
    return pedir<ListaContatos>(`/api/contatos?${parametros.toString()}`);
  },

  criarContato: (dados: {
    telefone: string;
    nome?: string;
    email?: string;
    tags?: string[];
  }) => pedir<{ ok: true; id: string }>("/api/contatos", {
    method: "POST",
    body: JSON.stringify(dados),
  }),

  atualizarContato: (
    id: string,
    dados: {
      nome?: string | null;
      email?: string | null;
      tags?: string[];
      campos?: Record<string, string>;
    },
  ) => pedir<{ ok: true }>(`/api/contatos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(dados),
  }),

  apagarContato: (id: string) =>
    pedir<{ ok: true; apagados: Record<string, number> }>(`/api/contatos/${id}`, {
      method: "DELETE",
    }),

  /** Devolve o CSV cru; quem transforma em download é a tela. */
  exportarContatos: () => pedirTexto("/api/contatos/exportar"),

  importarContatos: (csv: string) =>
    pedir<ResultadoImportacao>("/api/contatos/importar", {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),

  painel: () => pedir<Painel>("/api/painel"),

  bloqueios: () => pedir<Bloqueio[]>("/api/bloqueios"),

  criarBloqueio: (dados: { inicio: string; fim: string; motivo?: string }) =>
    pedir<{ ok: true; id: string; agendamentosNoPeriodo: number }>("/api/bloqueios", {
      method: "POST",
      body: JSON.stringify(dados),
    }),

  removerBloqueio: (id: string) =>
    pedir<{ ok: true }>(`/api/bloqueios/${id}`, { method: "DELETE" }),

  statusWhatsapp: () => pedir<StatusWhatsapp>("/api/whatsapp/status"),

  desconectarWhatsapp: () => pedir<{ ok: true }>("/api/whatsapp/desconectar", { method: "POST" }),

  conectarWhatsapp: () =>
    pedir<{ qrcode: string | null; instrucao: string }>(
      "/api/whatsapp/conectar",
      { method: "POST" },
    ),
};

// ---------------------------------------------------------------- demonstracao

import { apiDemo } from "./demo";

/**
 * Com VITE_DEMO=1 (npm run demo) o CRM roda com dados ficticios de clinica,
 * sem servidor, sem banco e sem WhatsApp. Serve para ajustar a interface e para
 * gravar a demo de vendas. Em producao a variavel nao existe e cai no apiReal.
 */
export const api = import.meta.env.VITE_DEMO === "1" ? apiDemo : apiReal;
