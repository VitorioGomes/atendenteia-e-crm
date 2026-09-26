import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { z } from "zod";
import type { ConfigNegocio } from "../config/negocio.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { lerEtiquetas } from "../lib/estados.js";
import { formatarSlot, horariosDisponiveis } from "../agenda/slots.js";
import { conferirDia } from "../lib/horario.js";
import { COMECO_DA_NOITE, MEIO_DIA } from "./prompt.js";
import {
  cancelarAgendamento,
  criarAgendamento,
  proximoAgendamento,
  remarcarAgendamento,
} from "../agenda/agendamentos.js";

/**
 * As ferramentas sao o que faz a IA "operar" o CRM em vez de so conversar.
 *
 * Principios:
 * - Toda ferramenta devolve texto curto em portugues, porque o proprio modelo le a resposta.
 * - Erro de ferramenta NUNCA derruba o atendimento: vira uma mensagem que o modelo entende.
 * - Nada aqui manda mensagem pro cliente. Quem fala com o cliente e o texto da resposta.
 */

export interface ContextoFerramentas {
  config: ConfigNegocio;
  contatoId: string;
  conversaId: string;
  negocioId: string; // id do Deal (card do CRM)
  telefone: string;
}

export interface Efeitos {
  transferiuParaHumano: boolean;
  motivoTransferencia: string | null;
  agendou: boolean;
  cancelouAgendamento: boolean;
  estagioNovo: string | null;
}

export function novosEfeitos(): Efeitos {
  return {
    transferiuParaHumano: false,
    motivoTransferencia: null,
    agendou: false,
    cancelouAgendamento: false,
    estagioNovo: null,
  };
}

// ---------------------------------------------------------------------------
// Definicoes enviadas para o modelo
// ---------------------------------------------------------------------------

/**
 * Os estagios que a IA pode escolher em mover_estagio.
 *
 * Ficam de fora o de "tem horario marcado" (o sistema move ao agendar) e os que so a
 * equipe move. Regra em texto no prompt nao segurou o modelo: no primeiro teste real
 * ele moveu para "Avaliacao agendada" sem nenhum agendamento existir. Opcao que nao
 * esta no enum, ele nao consegue escolher.
 */
export function estagiosQueAIaMove(config: ConfigNegocio): string[] {
  return config.negocio.funil.estagios
    .filter((e) => !e.aoAgendar && !e.somenteEquipe && !e.aoComparecer)
    .map((e) => e.chave);
}

export function definirFerramentas(config: ConfigNegocio): Anthropic.Tool[] {
  const { negocio } = config;
  const chavesEstagio = estagiosQueAIaMove(config);
  const camposConhecidos = [
    "nome",
    "email",
    ...negocio.camposExtras.map((c) => c.chave),
    ...negocio.objetivo.perguntasQualificacao.map((p) => p.campo),
  ];
  const camposUnicos = [...new Set(camposConhecidos)];
  const vocabulario = negocio.etiquetas.map((e) => e.nome);

  // O servico vira lista fechada. Livre, a IA escreveu "Tosa completa" quando a
  // configuracao dizia "Tosa completa (cachorro)": a busca por nome falhou, a tosa de
  // 2h foi marcada com a duracao padrao de 1h, e a segunda hora ficou livre para outro
  // pet numa mesa ocupada (teste de 22/09/2026). Opcao fora do enum ela nao escolhe.
  //
  // So entram os servicos marcados "agendavel" (revisao geral de 26/09/2026: o campo
  // existia, a clinica de exemplo marcava so a Avaliacao, e a IA podia marcar qualquer
  // um). Negocio que nao marcou nenhum, como os gerados pela skill, marca todos.
  const agendaveis = negocio.servicos.filter((s) => s.agendavel);
  const nomesDosServicos = (agendaveis.length ? agendaveis : negocio.servicos).map((s) => s.nome);
  const enumDeServicos = nomesDosServicos.length ? { enum: nomesDosServicos } : {};

  const ferramentas: Anthropic.Tool[] = [
    {
      name: "atualizar_lead",
      description:
        "Guarda no CRM o que voce descobriu sobre a pessoa. Chame assim que souber de algo novo, " +
        "na mesma resposta. Nao espere o fim da conversa. " +
        "Mande SO o que voce descobriu de verdade: campo que voce ainda nao sabe fica de fora. " +
        'Nunca escreva "nao informado", "nao sei" ou traco no lugar de um dado que falta.',
      input_schema: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Primeiro nome ou nome completo da pessoa." },
          email: { type: "string" },
          campos: {
            type: "object",
            description:
              `Outros dados do lead. Chaves aceitas: ${camposUnicos.join(", ")}. ` +
              "Use exatamente essas chaves.",
            additionalProperties: { type: "string" },
          },
          // A lista de etiquetas so entra quando o negocio definiu um
          // vocabulario. Sem enum a IA inventa variacao para o mesmo conceito
          // e as etiquetas param de servir para filtrar.
          ...(vocabulario.length > 0
            ? {
                tags: {
                  type: "array",
                  items: { type: "string", enum: vocabulario },
                  description:
                    "TODAS as etiquetas que se aplicam a esta pessoa agora, escolhidas da " +
                    "lista permitida. Manda a lista completa, nao so as novas: o que voce " +
                    "omitir e removido. Deixe de fora o que deixou de ser verdade.",
                },
              }
            : {}),
        },
      },
    },
    {
      name: "mover_estagio",
      description:
        "Move o card do lead no funil do CRM. Chame assim que a condicao do estagio for atingida.",
      input_schema: {
        type: "object",
        properties: {
          estagio: { type: "string", enum: chavesEstagio },
          motivo: { type: "string", description: "Uma frase curta explicando por que moveu." },
        },
        required: ["estagio", "motivo"],
      },
    },
    {
      name: "registrar_resumo",
      description:
        "Atualiza o resumo do lead no CRM. E o que o dono do negocio le antes de falar com a " +
        "pessoa, entao escreva para um humano: o que ela quer, o contexto e o que falta.",
      input_schema: {
        type: "object",
        properties: {
          resumo: {
            type: "string",
            description: "Resumo completo e atualizado, em 1 a 3 frases. Substitui o anterior.",
          },
          proximo_passo: {
            type: "string",
            description: "O que precisa acontecer agora, ex.: 'confirmar horario de quinta'.",
          },
        },
        required: ["resumo"],
      },
    },
    {
      name: "transferir_humano",
      description:
        "Passa a conversa para uma pessoa da equipe e faz voce parar de responder. " +
        "Use quando nao souber responder com seguranca ou nos casos previstos nas suas regras.",
      input_schema: {
        type: "object",
        properties: {
          motivo: {
            type: "string",
            description: "Por que precisa de humano. Aparece pra equipe no CRM.",
          },
        },
        required: ["motivo"],
      },
    },
  ];

  if (negocio.agenda.ativo) {
    ferramentas.push(
      {
        name: "consultar_horarios",
        description:
          "Lista horarios livres de verdade na agenda. Consulte ANTES de oferecer qualquer " +
          "horario. Nunca invente disponibilidade. Ofereca exatamente o que ela devolver, " +
          "na ordem em que vier. Se a pessoa disse manha, tarde ou noite, mande em periodo: " +
          "a filtragem e minha, nao sua.",
        input_schema: {
          type: "object",
          properties: {
            dia: {
              type: "string",
              description: "Opcional, no formato AAAA-MM-DD, quando a pessoa pedir um dia especifico.",
            },
            periodo: {
              type: "string",
              enum: ["manha", "tarde", "noite"],
              description: "Opcional, quando a pessoa disser o periodo em vez do horario.",
            },
            servico: {
              type: "string",
              ...enumDeServicos,
              description: "Servico desejado, se a pessoa ja disse. Define quanto tempo reservar.",
            },
          },
        },
      },
      {
        name: "agendar",
        description:
          "Marca o horario na agenda de verdade. Chame assim que a pessoa escolher um dos " +
          "horarios que voce ofereceu. E a escolha dela que confirma, nao uma segunda " +
          "pergunta sua. Se o horario tiver sido ocupado nesse meio tempo, eu aviso aqui; " +
          "nao consulte a agenda de novo so para conferir. " +
          "ANTES de chamar, confira duas coisas, porque depois de marcado nao da para " +
          "desfazer a impressao: (1) se o caso cai em algum item de 'Quando passar para um " +
          "humano', NAO marque, chame transferir_humano; (2) se o negocio exige algo para " +
          "atender (documento, vacina, idade, preparo), pergunte e tenha a resposta antes.",
        input_schema: {
          type: "object",
          properties: {
            servico: {
              type: "string",
              ...enumDeServicos,
              description: "O servico marcado. Define quanto tempo fica reservado na agenda.",
            },
            data_hora: {
              type: "string",
              description: "Inicio, no formato AAAA-MM-DDTHH:MM (horario local do negocio).",
            },
            observacao: { type: "string" },
          },
          required: ["servico", "data_hora"],
        },
      },
      {
        name: "remarcar_agendamento",
        description:
          "Muda o compromisso que a pessoa ja tem para outro horario. Use quando ela pedir " +
          "para adiar, antecipar ou trocar o dia. NUNCA marque um novo sem remarcar o antigo: " +
          "isso deixaria dois horarios presos para a mesma pessoa. Consulte os horarios livres " +
          "antes e confirme o novo horario com ela.",
        input_schema: {
          type: "object",
          properties: {
            data_hora: {
              type: "string",
              description: "Novo inicio, no formato AAAA-MM-DDTHH:MM.",
            },
            motivo: { type: "string", description: "Por que remarcou, em poucas palavras." },
          },
          required: ["data_hora"],
        },
      },
      {
        name: "cancelar_agendamento",
        description:
          "Cancela o compromisso da pessoa e libera o horario para outros. Use quando ela " +
          "disser claramente que nao vai mais. Se ela so quiser mudar de dia, use " +
          "remarcar_agendamento em vez disto.",
        input_schema: {
          type: "object",
          properties: {
            motivo: { type: "string", description: "Motivo informado pela pessoa." },
          },
          required: ["motivo"],
        },
      },
    );
  }

  return ferramentas;
}

// ---------------------------------------------------------------------------
// Execucao
// ---------------------------------------------------------------------------

const EsquemaAtualizarLead = z.object({
  nome: z.string().optional(),
  email: z.string().optional(),
  campos: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  tags: z.array(z.string()).optional(),
});

const EsquemaMoverEstagio = z.object({ estagio: z.string(), motivo: z.string() });
const EsquemaResumo = z.object({ resumo: z.string(), proximo_passo: z.string().optional() });
const EsquemaTransferir = z.object({ motivo: z.string() });
const EsquemaConsultar = z.object({
  dia: z.string().optional(),
  periodo: z.enum(["manha", "tarde", "noite"]).optional(),
  servico: z.string().optional(),
});
const EsquemaAgendar = z.object({
  servico: z.string(),
  data_hora: z.string(),
  observacao: z.string().optional(),
});
const EsquemaRemarcar = z.object({ data_hora: z.string(), motivo: z.string().optional() });
const EsquemaCancelarAgendamento = z.object({ motivo: z.string() });

export async function executarFerramenta(
  nome: string,
  entrada: unknown,
  ctx: ContextoFerramentas,
  efeitos: Efeitos,
): Promise<string> {
  try {
    switch (nome) {
      case "atualizar_lead":
        return await atualizarLead(EsquemaAtualizarLead.parse(entrada), ctx);
      case "mover_estagio":
        return await moverEstagio(EsquemaMoverEstagio.parse(entrada), ctx, efeitos);
      case "registrar_resumo":
        return await registrarResumo(EsquemaResumo.parse(entrada), ctx);
      case "transferir_humano":
        return await transferirHumano(EsquemaTransferir.parse(entrada), ctx, efeitos);
      case "consultar_horarios":
        return await consultarHorarios(EsquemaConsultar.parse(entrada), ctx);
      case "agendar":
        return await agendar(EsquemaAgendar.parse(entrada), ctx, efeitos);
      case "remarcar_agendamento":
        return await remarcar(EsquemaRemarcar.parse(entrada), ctx, efeitos);
      case "cancelar_agendamento":
        return await cancelar(EsquemaCancelarAgendamento.parse(entrada), ctx, efeitos);
      default:
        return `Ferramenta "${nome}" nao existe.`;
    }
  } catch (e) {
    logger.error({ err: e, ferramenta: nome, entrada }, "falha ao executar ferramenta");
    // Devolver o erro como texto deixa o modelo se recuperar em vez de travar o atendimento.
    return `Nao consegui executar essa acao agora (${(e as Error).message}). Siga a conversa normalmente e tente de novo depois.`;
  }
}

/**
 * O modelo, quando nao sabe, as vezes preenche em vez de omitir.
 *
 * No primeiro teste real (17/09/2026) ele gravou nome = "nao informado" — e isso
 * apagou o nome que o WhatsApp ja dava ("Vitorio Augusto"). O card ficou chamado
 * "nao informado" no funil. Placeholder e pior que campo vazio: o vazio a gente
 * sabe preencher depois, o placeholder parece dado.
 */
const LIXO = [
  "nao informado",
  "nao informou",
  "nao sei",
  "nao disse",
  "desconhecido",
  "sem nome",
  "n/a",
  "na",
  "null",
  "undefined",
  "-",
  "?",
];

/**
 * E-mail precisa ter cara de e-mail. No teste de 22/09/2026 a IA gravou o telefone
 * da pessoa no campo de e-mail ("551190001234"): nao e placeholder, entao passava pelo
 * filtro de lixo, e o contato ficava com um e-mail que ninguem consegue usar.
 * Sem expressao regular de proposito: escape escrito a mao ja se perdeu neste projeto.
 */
export function pareceEmail(valor: unknown): boolean {
  if (typeof valor !== "string") return false;
  const limpo = valor.trim();
  const partes = limpo.split("@");
  if (partes.length !== 2 || limpo.includes(" ")) return false;
  const [usuario, dominio] = partes;
  return Boolean(usuario) && Boolean(dominio) && dominio!.includes(".") && !dominio!.endsWith(".");
}

export function ehValorUtil(valor: unknown): boolean {
  if (typeof valor === "number" || typeof valor === "boolean") return true;
  const limpo = typeof valor === "string" ? valor.trim() : "";
  if (limpo.length < 2) return false;
  const simples = limpo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return !LIXO.includes(simples);
}

async function atualizarLead(
  dados: z.infer<typeof EsquemaAtualizarLead>,
  ctx: ContextoFerramentas,
): Promise<string> {
  const contato = await db.contact.findUniqueOrThrow({ where: { id: ctx.contatoId } });
  const camposAtuais = (contato.fields ?? {}) as Prisma.InputJsonObject;
  const camposLimpos = Object.fromEntries(
    Object.entries(dados.campos ?? {}).filter(([, v]) => ehValorUtil(v)),
  );
  const novosCampos: Prisma.InputJsonObject = { ...camposAtuais, ...camposLimpos };
  const nome = ehValorUtil(dados.nome) ? dados.nome : undefined;
  const email = ehValorUtil(dados.email) && pareceEmail(dados.email) ? dados.email : undefined;

  /**
   * Etiquetas: a IA manda o conjunto completo dela, e esse conjunto SUBSTITUI
   * as etiquetas do vocabulario. Antes o codigo fazia uniao, entao quem foi
   * marcado "urgente" em janeiro continuava "urgente" em dezembro.
   *
   * O que o dono escreveu a mao e que nao esta no vocabulario sobrevive: a IA
   * nao apaga etiqueta que ela nem sabe que existe.
   */
  const vocabulario = new Set(ctx.config.negocio.etiquetas.map((e) => e.nome));
  const etiquetasAtuais = lerEtiquetas(contato.tags);
  const tagsFinais = dados.tags
    ? [
        ...etiquetasAtuais.filter((t) => !vocabulario.has(t)),
        ...dados.tags.filter((t) => vocabulario.has(t)),
      ]
    : etiquetasAtuais;

  await db.contact.update({
    where: { id: ctx.contatoId },
    data: {
      name: nome ?? contato.name,
      email: email ?? contato.email,
      fields: novosCampos,
      tags: [...new Set(tagsFinais)],
    },
  });

  if (nome && nome !== contato.name) {
    await db.deal.update({
      where: { id: ctx.negocioId },
      data: { title: nome },
    });
  }

  const registrados = [
    nome && `nome=${nome}`,
    email && `email=${email}`,
    ...Object.entries(camposLimpos).map(([k, v]) => `${k}=${v}`),
    dados.tags?.length && `tags=${dados.tags.join(",")}`,
  ].filter(Boolean);

  return `Salvo no CRM: ${registrados.join(", ") || "nada novo"}.`;
}

async function moverEstagio(
  dados: z.infer<typeof EsquemaMoverEstagio>,
  ctx: ContextoFerramentas,
  efeitos: Efeitos,
): Promise<string> {
  // Estes dois nem aparecem na lista de opcoes da ferramenta; a checagem aqui e a
  // segunda trava, para o caso de o modelo escrever a chave mesmo assim.
  const alvo = ctx.config.negocio.funil.estagios.find((e) => e.chave === dados.estagio);
  if (alvo?.aoAgendar) {
    return (
      `Voce nao move para "${alvo.nome}". O sistema move sozinho quando o horario e marcado ` +
      "com a ferramenta agendar. Se a pessoa ainda nao confirmou um horario, continue a conversa: " +
      "ofereca horarios (consultar_horarios) e so agende depois que ela escolher."
    );
  }
  if (alvo?.somenteEquipe || alvo?.aoComparecer) {
    return `Voce nao move para "${alvo.nome}": so a equipe move para esse estagio.`;
  }

  const estagio = await db.stage.findUnique({ where: { key: dados.estagio } });
  if (!estagio) {
    const validos = estagiosQueAIaMove(ctx.config).join(", ");
    return `O estagio "${dados.estagio}" nao existe. Use um destes: ${validos}.`;
  }

  const negocioAtual = await db.deal.findUniqueOrThrow({
    where: { id: ctx.negocioId },
    include: { stage: true },
  });

  if (negocioAtual.stageId === estagio.id) {
    return `O lead ja estava em "${estagio.name}". Nada mudou.`;
  }

  const definicao = ctx.config.negocio.funil.estagios.find((e) => e.chave === dados.estagio);

  await db.$transaction([
    db.deal.update({
      where: { id: ctx.negocioId },
      data: {
        stageId: estagio.id,
        status: definicao?.ganho ? "WON" : definicao?.perdido ? "LOST" : "OPEN",
        lostReason: definicao?.perdido ? dados.motivo : null,
      },
    }),
    db.dealEvent.create({
      data: {
        dealId: ctx.negocioId,
        type: "stage_changed",
        body: `${negocioAtual.stage.name} -> ${estagio.name}: ${dados.motivo}`,
        author: "ia",
      },
    }),
  ]);

  efeitos.estagioNovo = dados.estagio;
  return `Card movido para "${estagio.name}".`;
}

async function registrarResumo(
  dados: z.infer<typeof EsquemaResumo>,
  ctx: ContextoFerramentas,
): Promise<string> {
  await db.$transaction([
    db.deal.update({
      where: { id: ctx.negocioId },
      data: { summary: dados.resumo, nextStep: dados.proximo_passo ?? null },
    }),
    db.dealEvent.create({
      data: {
        dealId: ctx.negocioId,
        type: "summary",
        body: dados.proximo_passo ? `${dados.resumo}\nProximo passo: ${dados.proximo_passo}` : dados.resumo,
        author: "ia",
      },
    }),
  ]);
  return "Resumo atualizado no CRM.";
}

async function transferirHumano(
  dados: z.infer<typeof EsquemaTransferir>,
  ctx: ContextoFerramentas,
  efeitos: Efeitos,
): Promise<string> {
  await db.$transaction([
    db.conversation.update({
      where: { id: ctx.conversaId },
      data: { mode: "HUMAN", handoffReason: dados.motivo, botPausedUntil: null },
    }),
    db.dealEvent.create({
      data: {
        dealId: ctx.negocioId,
        type: "handoff",
        body: `Transferido para atendimento humano: ${dados.motivo}`,
        author: "ia",
      },
    }),
    db.deal.update({
      where: { id: ctx.negocioId },
      data: { nextStep: `ATENDER: ${dados.motivo}` },
    }),
  ]);

  efeitos.transferiuParaHumano = true;
  efeitos.motivoTransferencia = dados.motivo;

  return (
    "A conversa foi marcada como atendimento humano e voce parou de responder. " +
    "Mande apenas uma mensagem curta avisando que alguem da equipe vai continuar."
  );
}

/** Tres e o que cabe numa mensagem de WhatsApp sem virar lista. */
const OFERTA_POR_VEZ = 3;

/** "09:00, 09:40 ou 10:20" — como uma pessoa fala, nao "09:00 ou 09:40 ou 10:20". */
const listar = (itens: string[]): string =>
  itens.length > 1 ? `${itens.slice(0, -1).join(", ")} ou ${itens.at(-1)}` : (itens[0] ?? "");

/**
 * Manha, tarde e noite em horas [inicio, fim). O corte da noite e o mesmo que decide
 * quais periodos a IA oferece (prompt.ts): se os dois discordassem, ela ofereceria um
 * periodo que depois nao devolve horario nenhum.
 */
const FAIXAS: Record<"manha" | "tarde" | "noite", [number, number]> = {
  manha: [0, MEIO_DIA / 60],
  tarde: [MEIO_DIA / 60, COMECO_DA_NOITE / 60],
  noite: [COMECO_DA_NOITE / 60, 24],
};

/**
 * O texto que a IA recebe depois de consultar a agenda.
 *
 * Separado da consulta ao banco para poder ser testado: e aqui que mora a regra que
 * o teste real quebrou em 20/09/2026.
 */
export function ofertaDeHorarios(
  todos: DateTime[],
  dados: z.infer<typeof EsquemaConsultar>,
): string {
  const faixa = dados.periodo ? FAIXAS[dados.periodo] : null;
  const slots = faixa ? todos.filter((s) => s.hour >= faixa[0] && s.hour < faixa[1]) : todos;

  if (!slots.length) {
    const onde = [dados.dia && `em ${dados.dia}`, dados.periodo && `de ${dados.periodo}`]
      .filter(Boolean)
      .join(" ");
    return onde
      ? `Nao ha horario livre ${onde}. Ofereca outro dia ou periodo e consulte de novo.`
      : "Nao ha horario livre na janela da agenda. Avise a pessoa e chame transferir_humano.";
  }

  const oferta = slots.slice(0, OFERTA_POR_VEZ);
  const sobraram = slots.length - oferta.length;

  // Um horario por linha, com o dia inteiro repetido em cada um, virava lista com
  // hifen no WhatsApp — "Segunda-feira, 21/09 as 09:00" tres vezes seguidas. O dia
  // vem uma vez, na frente dos horarios dele.
  const porDia = new Map<string, DateTime[]>();
  for (const s of oferta) {
    const dia = s.setLocale("pt-BR").toFormat("cccc, dd/LL");
    porDia.set(dia, [...(porDia.get(dia) ?? []), s]);
  }

  const linhas = [...porDia.entries()].map(
    ([dia, horas]) =>
      `${dia}: ` +
      horas.map((s) => `${s.toFormat("HH:mm")} [${s.toFormat("yyyy-LL-dd'T'HH:mm")}]`).join(", "),
  );

  const exemplo = [...porDia.entries()][0];
  const frase = exemplo
    ? `"Tenho ${exemplo[0]}, as ${listar(exemplo[1].map((s) => s.toFormat("HH:mm")))}. ` +
      'Qual desses horarios fica melhor para voce?"'
    : "";

  // Escolher quais horarios oferecer nao pode ser do modelo: entre uma mensagem e a
  // seguinte ele escolhia outros tres, e o horario que a pessoa tinha acabado de
  // aceitar sumia da lista. A escolha e daqui, e e sempre a mesma.
  return (
    "Ofereca EXATAMENTE estes horarios, nesta ordem, e mais nenhum:\n" +
    linhas.join("\n") +
    `\n\nEscreva numa frase so, com o dia dito uma vez: ${frase} Nada de lista, de hifen ` +
    "no comeco de linha, nem de repetir o dia da semana em cada horario.\n" +
    "Quando a pessoa escolher um deles, chame agendar com o codigo entre colchetes. " +
    "Nao pergunte de novo se ela confirma, e nao consulte a agenda outra vez: a escolha " +
    "dela ja e a confirmacao." +
    (sobraram > 0
      ? `\nHa mais ${sobraram} horario(s) livre(s). Se ela nao gostar de nenhum destes, consulte ` +
        "de novo dizendo o dia ou o periodo que ela pedir."
      : "\nNao ha outro horario livre alem destes.")
  );
}

async function consultarHorarios(
  dados: z.infer<typeof EsquemaConsultar>,
  ctx: ContextoFerramentas,
): Promise<string> {
  // Data no passado, ano errado ou dia fechado nao podem chegar a agenda: ela
  // devolveria "sem horario" e o modelo diria ao cliente que esta lotado.
  if (dados.dia) {
    const problema = conferirDia(ctx.config.negocio, dados.dia);
    if (problema) return problema;
  }

  const servico = dados.servico
    ? ctx.config.negocio.servicos.find(
        (s) => s.nome.toLowerCase() === dados.servico?.toLowerCase(),
      )
    : undefined;

  // Busca larga porque o periodo e filtrado depois: pedir "tarde" com um teto de 8
  // devolveria oito horarios de manha e nenhum da tarde.
  const todos = await horariosDisponiveis(ctx.config.negocio, {
    duracaoMin: servico?.duracaoMin,
    diaEspecifico: dados.dia,
    limite: dados.periodo ? 60 : 12,
  });

  return ofertaDeHorarios(todos, dados);
}

/**
 * O que a IA deve escrever depois de marcar.
 *
 * Esta e a ultima mensagem que a pessoa le antes do dia do compromisso: terminar em
 * "marquei para segunda as 09:00." deixa a conversa seca e sem porta de volta.
 */
export function confirmacaoDoAgendamento(servico: string, quando: DateTime): string {
  return (
    `Agendado com sucesso: ${servico}, ${formatarSlot(quando)}. ` +
    "Na sua resposta, nesta ordem: confirme o dia e a hora, diga onde e (se o encontro " +
    "for presencial e voce souber o endereco), e FECHE se colocando a disposicao e se " +
    'despedindo. Por exemplo: "Qualquer duvida, e so me chamar. Ate segunda!".'
  );
}

async function agendar(
  dados: z.infer<typeof EsquemaAgendar>,
  ctx: ContextoFerramentas,
  efeitos: Efeitos,
): Promise<string> {
  const zona = ctx.config.negocio.horarios.timezone;

  // O mesmo erro de ano que a consulta pega. Sem isto, marcar em 2025 voltava com
  // "esse horario e muito em cima", que nao diz ao modelo que o erro foi a data.
  const problema = conferirDia(ctx.config.negocio, dados.data_hora.slice(0, 10));
  if (problema) return `Nao marquei. ${problema}`;

  const quando = DateTime.fromISO(dados.data_hora, { zone: zona });

  // A pessoa ja tem horario: marcar outro deixaria dois presos no nome dela.
  const existente = await proximoAgendamento(ctx.contatoId);
  if (existente) {
    const atual = DateTime.fromJSDate(existente.scheduledAt).setZone(zona);
    return (
      `Essa pessoa JA TEM um agendamento: ${existente.service}, ${formatarSlot(atual)}. ` +
      "Nao marque outro. Se ela quer mudar de horario, use remarcar_agendamento; " +
      "se nao vai mais, use cancelar_agendamento."
    );
  }

  const resultado = await criarAgendamento(ctx.config, {
    contatoId: ctx.contatoId,
    negocioId: ctx.negocioId,
    servico: dados.servico,
    quando,
    observacao: dados.observacao,
    autor: "ia",
  });

  if (!resultado.ok) {
    return `Nao deu pra marcar: ${resultado.motivo} Consulte os horarios de novo e ofereca outro.`;
  }

  efeitos.agendou = true;
  return confirmacaoDoAgendamento(resultado.agendamento.service, quando);
}

async function remarcar(
  dados: z.infer<typeof EsquemaRemarcar>,
  ctx: ContextoFerramentas,
  efeitos: Efeitos,
): Promise<string> {
  const zona = ctx.config.negocio.horarios.timezone;

  const existente = await proximoAgendamento(ctx.contatoId);
  if (!existente) {
    return (
      "Essa pessoa nao tem nenhum agendamento futuro para remarcar. " +
      "Se ela quer marcar pela primeira vez, use consultar_horarios e depois agendar."
    );
  }

  const novaData = DateTime.fromISO(dados.data_hora, { zone: zona });
  const resultado = await remarcarAgendamento(ctx.config, existente.id, novaData, "ia");

  if (!resultado.ok) {
    return `Nao deu pra remarcar: ${resultado.motivo} Consulte os horarios livres e ofereca outro.`;
  }

  efeitos.agendou = true;
  return (
    `Remarcado para ${formatarSlot(novaData)}. O horario antigo foi liberado e o lembrete ` +
    "foi movido junto. Confirme a nova data com a pessoa e feche se colocando a " +
    'disposicao e se despedindo ("Qualquer duvida, e so me chamar. Ate quinta!").'
  );
}

async function cancelar(
  dados: z.infer<typeof EsquemaCancelarAgendamento>,
  ctx: ContextoFerramentas,
  efeitos: Efeitos,
): Promise<string> {
  const existente = await proximoAgendamento(ctx.contatoId);
  if (!existente) return "Essa pessoa nao tem nenhum agendamento futuro para cancelar.";

  const resultado = await cancelarAgendamento(existente.id, dados.motivo, "ia");
  if (!resultado.ok) return `Nao deu pra cancelar: ${resultado.motivo}`;

  efeitos.cancelouAgendamento = true;
  return (
    "Agendamento cancelado e horario liberado. Confirme com a pessoa de forma acolhedora " +
    "e, se fizer sentido, ofereca remarcar para outro dia."
  );
}
