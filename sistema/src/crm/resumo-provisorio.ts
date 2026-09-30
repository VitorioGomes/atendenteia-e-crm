import { DateTime } from "luxon";

/**
 * A frase do card enquanto a IA ainda nao escreveu o resumo.
 *
 * Teste 3 (27/09/2026): o resumo so apareceu no fim da conversa, e o card passou todo
 * esse tempo so com o nome, parecendo quebrado. A primeira ideia era mostrar a ultima
 * mensagem da pessoa; o dono preferiu um mini-resumo ("lead novo", "perguntando sobre
 * x", "call marcada"). Esta frase e montada pelo sistema com o que ele ja sabe, sem IA:
 * nao custa nada e nunca inventa. Quando o resumo de verdade chega, ele manda.
 */
export interface DadosDoCard {
  /** Nome do estagio, como aparece na coluna ("Qualificando"). */
  estagioNome: string;
  /** E o primeiro estagio do funil (o de entrada)? */
  primeiroEstagio: boolean;
  /** A pessoa ja mandou alguma mensagem? */
  temMensagem: boolean;
  /** Campos que a IA coletou, na ordem da configuracao. Valores vazios sao ignorados. */
  campos: Array<string | number | boolean | null | undefined>;
  etiquetas: string[];
  /** Proximo compromisso marcado, se houver. */
  agendamento: { servico: string; quando: Date } | null;
  timezone: string;
}

const MAX_DADOS = 3;

export function resumoProvisorio(d: DadosDoCard): string {
  if (d.agendamento) {
    const dia = DateTime.fromJSDate(d.agendamento.quando).setZone(d.timezone).setLocale("pt-BR");
    const quando = dia.toFormat("cccc, dd/LL 'às' HH:mm");
    // "na/no", nao "marcada para": o servico pode ser masculino ("Banho marcada" le
    // errado). E sabado e domingo pedem "no".
    const preposicao = dia.weekday >= 6 ? "no" : "na";
    return `${d.agendamento.servico} ${preposicao} ${quando}`;
  }

  if (!d.temMensagem) return "Lead novo, ainda sem conversa";

  const dados = [
    ...d.campos.filter((v) => v !== null && v !== undefined && String(v).trim() !== "").map(String),
    ...d.etiquetas,
  ];
  // Mesmo dado dito duas vezes (campo "gestor de trafego" e etiqueta igual) aparece uma vez.
  const unicos = [...new Map(dados.map((v) => [v.trim().toLowerCase(), v.trim()])).values()].slice(
    0,
    MAX_DADOS,
  );

  if (!unicos.length) {
    return d.primeiroEstagio ? "Lead novo, começou a conversa" : `${d.estagioNome}, em conversa`;
  }
  return `${d.estagioNome}: ${unicos.join(", ")}`;
}
