import { DateTime } from "luxon";
import { getNegocio } from "../config/negocio.js";
import { pensarEResponder } from "../agente/cerebro.js";
import { proximoAgendamento } from "../agenda/agendamentos.js";
import { formatarSlot } from "../agenda/slots.js";
import type { EstadoDoLead } from "../agente/prompt.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { lerEtiquetas } from "../lib/estados.js";
import {
  enviarTexto,
  enviarTextoParaNumero,
  marcarComoLida,
  marcarDigitando,
} from "../whatsapp/conexao.js";
import {
  numeroDoAviso,
  prometeuRetornoDoTime,
  textoDaPergunta,
  textoDoAviso,
} from "./aviso-equipe.js";
import { agendarFollowup, cancelarFollowup } from "./followup.js";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tempo de "digitando" proporcional ao tamanho, com teto. Sem isso o bot entrega o jogo. */
function tempoDeDigitacao(texto: string): number {
  return Math.min(5000, Math.max(900, texto.length * 35));
}

/**
 * Frase de cortesia que termina em "?" sem perguntar nada: "como posso ajudar?".
 * O limite de caracteres e o que separa a cortesia de uma pergunta de verdade
 * ("posso te ajudar a escolher entre clareamento e limpeza?" passa batido).
 */
const CORTESIA_VAZIA = /[^.!?\n]{0,40}\bposso[^.!?\n]{0,15}\bajud[^.!?\n]{0,20}\?/i;

/**
 * Tira a cortesia quando ela vem acompanhada de uma pergunta de verdade.
 *
 * "Sou a Marina... Como posso ajudar voce?" + "Antes de tudo, qual e o seu nome?"
 * sao duas perguntas antes de a pessoa dizer a primeira palavra — o dono viu isso
 * na primeira mensagem do teste real (19/09/2026). O prompt manda fazer uma pergunta
 * por vez, mas regra em texto nao segura modelo. Aqui vira garantia, e sem perder
 * conteudo: so sai a frase que nao pergunta nada, e so quando sobra outra pergunta.
 */
export function tirarPerguntaDeCortesia(texto: string): string {
  const perguntas = (texto.match(/\?/g) ?? []).length;
  if (perguntas < 2) return texto;

  const achou = CORTESIA_VAZIA.exec(texto);
  if (!achou) return texto;

  return (texto.slice(0, achou.index) + texto.slice(achou.index + achou[0].length))
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * O que fazer com o follow-up depois de responder.
 *
 * O follow-up existe para acordar quem sumiu no meio da conversa. Quem ja tem horario
 * marcado nao sumiu: ela esta esperando o dia. Quem cuida dela e o lembrete, que sai
 * algumas horas antes. Sem esta regra a pessoa marcava de manha e recebia "ainda tem
 * interesse?" a tarde, com a consulta dela marcada para o dia seguinte (achado em
 * 20/09/2026, no banco do teste real: job de followup PENDING com Appointment
 * SCHEDULED para o mesmo contato).
 *
 * Nao basta olhar o agendamento criado nesta rodada: quem marcou ontem e voltou hoje
 * so para perguntar o endereco tambem nao pode ganhar follow-up.
 */
export function destinoDoFollowup(situacao: {
  transferiuParaHumano: boolean;
  ehLembrete: boolean;
  temAgendamento: boolean;
  agendouAgora: boolean;
  cancelouAgora: boolean;
}): "cancelar" | "agendar" | "nada" {
  // Quem assumiu foi um humano: nada de follow-up automatico por cima.
  if (situacao.transferiuParaHumano) return "cancelar";

  // Desmarcou agora: voltou a ser alguem sem horario, e o follow-up vale de novo.
  if (situacao.cancelouAgora) return "agendar";

  if (situacao.agendouAgora || situacao.temAgendamento) return "cancelar";

  // Depois de um lembrete a bola esta com a pessoa. Cutucar de novo por
  // follow-up automatico seria perseguicao, nao atendimento.
  if (situacao.ehLembrete) return "nada";

  return "agendar";
}

/**
 * O nome do perfil do WhatsApp, quando da pra chamar a pessoa por ele.
 *
 * Nem todo perfil tem nome de gente: tem numero de telefone, emoji sozinho, "." e
 * nome de loja com 60 caracteres. Chamar alguem de "." e pior do que perguntar o
 * nome, entao o que nao passa aqui volta a ser desconhecido e a IA pergunta.
 */
export function nomeDoPerfil(bruto: string | null | undefined): string | null {
  const limpo = (bruto ?? "").trim();
  if (limpo.length < 2 || limpo.length > 40) return null;
  if (!/\p{L}{2}/u.test(limpo)) return null; // precisa de letra, nao so simbolo
  if (/^[+\d\s()-]+$/.test(limpo)) return null; // e um telefone, nao um nome
  return limpo;
}

/**
 * Quebra a resposta em mensagens separadas, como uma pessoa manda no WhatsApp.
 * Duas quebras de linha = mensagem nova. Nunca mais que 4 mensagens seguidas.
 */
export function quebrarEmMensagens(texto: string): string[] {
  const partes = texto
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (partes.length <= 4) return partes.length ? partes : [texto.trim()];

  const juntas = partes.slice(0, 3);
  juntas.push(partes.slice(3).join("\n\n"));
  return juntas;
}

async function avisarEquipe(
  config: ReturnType<typeof getNegocio>,
  dados: { cliente: string | null; telefone: string; motivo: string | null },
): Promise<void> {
  await mandarAviso(
    config,
    dados.telefone,
    textoDoAviso({ atendente: config.negocio.atendente.nome, ...dados }),
  );
}

/** Pergunta pendente: o time fica sabendo e a IA segue atendendo (teste 3). */
async function avisarPergunta(
  config: ReturnType<typeof getNegocio>,
  dados: { cliente: string | null; telefone: string; pergunta: string },
): Promise<void> {
  await mandarAviso(
    config,
    dados.telefone,
    textoDaPergunta({ atendente: config.negocio.atendente.nome, ...dados }),
  );
}

async function mandarAviso(
  config: ReturnType<typeof getNegocio>,
  telefoneDoCliente: string,
  texto: string,
): Promise<void> {
  const numero = numeroDoAviso(config.negocio.handoff.avisarNoWhatsapp);
  if (!numero) return;
  try {
    await enviarTextoParaNumero(numero, texto);
    logger.info({ telefone: telefoneDoCliente }, "equipe avisada no WhatsApp");
  } catch (e) {
    // O aviso nao pode derrubar o atendimento: a conversa ja esta marcada no CRM.
    logger.error({ err: e }, "falha ao avisar a equipe no WhatsApp");
  }
}

export async function enviarResposta(
  conversaId: string,
  telefone: string,
  texto: string,
): Promise<void> {
  const mensagens = quebrarEmMensagens(tirarPerguntaDeCortesia(texto));

  // Quem vai responder e a IA: a mensagem da pessoa aparece como lida (dois tracos
  // azuis). Conectado como "nao online", o WhatsApp so confirmava com um traco, e para
  // quem escreveu parecia que nada tinha chegado (teste 3, 27/09/2026).
  await marcarComoLida(telefone);

  for (const [indice, mensagem] of mensagens.entries()) {
    const espera = tempoDeDigitacao(mensagem);
    await marcarDigitando(telefone, espera);
    await dormir(espera);

    try {
      const { id } = await enviarTexto(telefone, mensagem);
      await db.message.create({
        data: {
          conversationId: conversaId,
          direction: "OUT",
          author: "BOT",
          kind: "TEXT",
          text: mensagem,
          externalId: id ?? null,
        },
      });
    } catch (e) {
      logger.error({ err: e, telefone }, "falha ao enviar mensagem no WhatsApp");
      throw e;
    }

    // Pausa curta entre mensagens da mesma resposta.
    if (indice < mensagens.length - 1) await dormir(600);
  }

  await db.conversation.update({
    where: { id: conversaId },
    data: { lastOutboundAt: new Date() },
  });
}

/**
 * Roda o atendente para uma conversa. Chamado pelo buffer (debounce) e pelo worker
 * (follow-up). Precisa ser seguro para rodar duas vezes seguidas sem estragar nada.
 */
export interface ContextoDisparo {
  /** Retomada de lead que parou de responder. */
  followup?: { tentativa: number; instrucao: string };
  /** Lembrete de compromisso, disparado pelo worker. */
  lembrete?: { servico: string; quando: string; instrucao: string };
}

export async function processarConversa(
  conversaId: string,
  contexto: ContextoDisparo = {},
): Promise<void> {
  const conversa = await db.conversation.findUnique({
    where: { id: conversaId },
    include: { contact: true },
  });

  if (!conversa) return;

  if (conversa.mode !== "BOT") {
    logger.debug({ conversaId }, "conversa em atendimento humano, o bot nao responde");
    return;
  }

  if (conversa.botPausedUntil && conversa.botPausedUntil > new Date()) {
    logger.debug({ conversaId }, "bot pausado (alguem da equipe respondeu)");
    return;
  }

  const config = getNegocio();

  const negocio = await db.deal.findFirst({
    where: { contactId: conversa.contactId, status: "OPEN" },
    orderBy: { createdAt: "desc" },
    include: { stage: true },
  });
  if (!negocio) {
    logger.warn({ conversaId }, "conversa sem card no CRM");
    return;
  }

  const jaFalamos = await db.message.count({
    where: { conversationId: conversaId, direction: "OUT" },
  });

  // A IA precisa saber que a pessoa ja tem horario, senao marca um segundo
  // em vez de remarcar o que existe.
  const agendado = await proximoAgendamento(conversa.contactId);

  const lead: EstadoDoLead = {
    nome: conversa.contact.name,
    nomeWhatsapp: nomeDoPerfil(conversa.contact.pushName),
    telefone: conversa.contact.phone,
    estagioAtual: negocio.stage.key,
    estagioNome: negocio.stage.name,
    resumo: negocio.summary,
    camposConhecidos: (conversa.contact.fields ?? {}) as Record<string, unknown>,
    tags: lerEtiquetas(conversa.contact.tags),
    primeiraConversa: jaFalamos === 0,
    ehFollowup: contexto.followup,
    ehLembrete: contexto.lembrete,
    agendamentoAtual: agendado
      ? {
          servico: agendado.service,
          quando: formatarSlot(
            DateTime.fromJSDate(agendado.scheduledAt).setZone(config.negocio.horarios.timezone),
          ),
        }
      : null,
  };

  const resultado = await pensarEResponder(config, lead, {
    config,
    contatoId: conversa.contactId,
    conversaId: conversa.id,
    negocioId: negocio.id,
    telefone: conversa.contact.phone,
  });

  if (!resultado.texto) {
    logger.warn({ conversaId }, "o agente nao produziu texto de resposta");
    return;
  }

  try {
    await enviarResposta(conversaId, conversa.contact.phone, resultado.texto);
  } finally {
    // Mesmo se a resposta ao cliente falhar, quem atende precisa saber que foi chamado.
    const cliente = conversa.contact.name ?? nomeDoPerfil(conversa.contact.pushName);
    if (resultado.efeitos.transferiuParaHumano) {
      await avisarEquipe(config, {
        cliente,
        telefone: conversa.contact.phone,
        motivo: resultado.efeitos.motivoTransferencia,
      });
    }

    const perguntas = [...resultado.efeitos.perguntasParaEquipe];
    // Rede de seguranca: prometeu um retorno do time e nao avisou ninguem. A pergunta e
    // a ultima coisa que a pessoa escreveu, que e o que o time precisa ler.
    if (
      !perguntas.length &&
      !resultado.efeitos.transferiuParaHumano &&
      prometeuRetornoDoTime(resultado.texto)
    ) {
      const ultima = await db.message.findFirst({
        where: { conversationId: conversaId, direction: "IN" },
        orderBy: { createdAt: "desc" },
        select: { text: true, transcript: true },
      });
      const pergunta = (ultima?.transcript ?? ultima?.text ?? "").trim();
      if (pergunta) {
        perguntas.push(pergunta);
        await db.dealEvent.create({
          data: { dealId: negocio.id, type: "question", body: `Pergunta para a equipe: ${pergunta}`, author: "ia" },
        });
        logger.warn({ conversaId }, "a IA prometeu confirmar com o time sem avisar; o sistema avisou");
      }
    }
    for (const pergunta of perguntas) {
      await avisarPergunta(config, { cliente, telefone: conversa.contact.phone, pergunta });
    }
  }

  const destino = destinoDoFollowup({
    transferiuParaHumano: resultado.efeitos.transferiuParaHumano,
    ehLembrete: Boolean(contexto.lembrete),
    temAgendamento: agendado !== null,
    agendouAgora: resultado.efeitos.agendou,
    cancelouAgora: resultado.efeitos.cancelouAgendamento,
  });

  if (destino === "cancelar") {
    await cancelarFollowup(conversaId);
    return;
  }
  if (destino === "nada") return;

  const proximaTentativa = contexto.followup ? contexto.followup.tentativa + 1 : 1;
  await agendarFollowup(conversaId, negocio.id, proximaTentativa);
}
