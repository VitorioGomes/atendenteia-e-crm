/** Formatações que aparecem na tela. Tudo em português do Brasil. */

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function desde(iso: string | null): string {
  if (!iso) return "—";
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);

  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;

  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas}h`;

  const dias = Math.round(horas / 24);
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

/**
 * Hora na lista de conversas, como todo app de mensagem faz: hoje mostra a hora,
 * ontem diz "ontem", nesta semana diz o dia, antes disso a data.
 */
export function quandoNaLista(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const inicioDeHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
  const dia = 86_400_000;

  if (d.getTime() >= inicioDeHoje) return hora(iso);
  if (d.getTime() >= inicioDeHoje - dia) return "ontem";
  if (d.getTime() >= inicioDeHoje - 6 * dia) return DIAS[d.getDay()]!;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/**
 * Separador de dia dentro da conversa: "Hoje", "Ontem", o dia da semana nesta semana,
 * e a data antes disso.
 */
export function rotuloDoDia(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const inicioDeHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
  const dia = 86_400_000;

  if (d.getTime() >= inicioDeHoje) return "Hoje";
  if (d.getTime() >= inicioDeHoje - dia) return "Ontem";
  if (d.getTime() >= inicioDeHoje - 6 * dia) {
    const nome = DIAS[d.getDay()]!;
    return nome.charAt(0).toUpperCase() + nome.slice(1);
  }
  return d.toLocaleDateString("pt-BR");
}

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function dataHora(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} às ${hora(iso)}`;
}

export function diaPorExtenso(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const amanha = new Date(hoje.getTime() + 86400000);
  const mesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  if (mesmoDia(d, hoje)) return "Hoje";
  if (mesmoDia(d, amanha)) return "Amanhã";
  return `${DIAS[d.getDay()]}, ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}

export function moeda(valor: number | null): string {
  if (valor == null) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const ROTULO_STATUS: Record<string, string> = {
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
  CANCELED: "Cancelado",
  DONE: "Compareceu",
  NOSHOW: "Não veio",
};

export const rotuloStatus = (s: string): string => ROTULO_STATUS[s] ?? s;

/**
 * Nome como ele aparece na tela.
 *
 * O WhatsApp entrega o nome do perfil exatamente como a pessoa digitou, e muita
 * gente escreve tudo em minusculo ("paixao"). Num CRM isso parece defeito do
 * sistema, nao escolha do dono do perfil. Palavra de ligacao fica minuscula, e
 * quem ja escreveu com maiuscula no meio ("McDonald", "iPhone") nao e mexido.
 */
const LIGACOES = new Set(["de", "da", "do", "das", "dos", "e"]);

export function nomeExibido(nome: string | null | undefined): string {
  const limpo = (nome ?? "").trim();
  if (!limpo) return "";

  return limpo
    .split(/\s+/)
    .map((palavra, indice) => {
      if (/[A-ZÀ-Ý]/.test(palavra.slice(1))) return palavra;
      const minuscula = palavra.toLocaleLowerCase("pt-BR");
      if (indice > 0 && LIGACOES.has(minuscula)) return minuscula;
      return minuscula.charAt(0).toLocaleUpperCase("pt-BR") + minuscula.slice(1);
    })
    .join(" ");
}

/**
 * Chaves que aparecem em quase todo negocio, para quando a configuracao nao traz
 * rotulo. A chave e escrita sem acento (e nome de campo no banco); o rotulo e o que
 * a pessoa le.
 */
const ROTULOS_CONHECIDOS: Record<string, string> = {
  procedimento_interesse: "Procedimento de interesse",
  servico_interesse: "Serviço de interesse",
  urgencia: "Urgência",
  // "Convênio: particular" lia estranho; o campo guarda as duas respostas.
  convenio: "Convênio ou particular",
  forma_pagamento: "Forma de pagamento",
  melhor_periodo: "Melhor período",
  endereco: "Endereço",
  bairro: "Bairro",
  cidade: "Cidade",
  observacao: "Observação",
  orcamento: "Orçamento",
};

/** Palavras que a chave perde o acento ao virar nome de campo. */
const ACENTOS: Record<string, string> = {
  urgencia: "urgência",
  servico: "serviço",
  servicos: "serviços",
  preferencia: "preferência",
  horario: "horário",
  periodo: "período",
  endereco: "endereço",
  orcamento: "orçamento",
  observacao: "observação",
  convenio: "convênio",
  numero: "número",
  duvida: "dúvida",
  proximo: "próximo",
  indicacao: "indicação",
  experiencia: "experiência",
};

/**
 * Rotulo de um campo coletado pela IA. Primeiro o que a configuracao do negocio
 * diz (veio da entrevista), depois os conhecidos, e por fim a chave arrumada:
 * sem sublinhado, com acento nas palavras comuns e com a primeira letra maiuscula.
 * Nunca a chave crua do banco na tela.
 */
export function rotuloDoCampo(chave: string, daConfiguracao?: Record<string, string>): string {
  const configurado = daConfiguracao?.[chave]?.trim();
  if (configurado) return configurado;
  if (ROTULOS_CONHECIDOS[chave]) return ROTULOS_CONHECIDOS[chave];

  const texto = chave
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((p) => ACENTOS[p.toLowerCase()] ?? p.toLowerCase())
    .join(" ");
  return texto.charAt(0).toLocaleUpperCase("pt-BR") + texto.slice(1);
}

/** "segunda-feira, 21/09 às 09:00": o mesmo jeito que o historico e a IA escrevem. */
export function diaEHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const semana = d.toLocaleDateString("pt-BR", { weekday: "long" });
  const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${semana}, ${dia} às ${hora(iso)}`;
}
