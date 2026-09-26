import { getNegocio } from "../config/negocio.js";
import { garantirLead } from "../crm/leads.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { limparNomeArquivo, salvarMidia } from "../lib/midia.js";
import { variantesTelefone } from "../lib/telefone.js";
import type { MensagemRecebida } from "../whatsapp/payload.js";
import { agendarResposta, cancelarResposta } from "./buffer.js";
import { cancelarFollowup } from "./followup.js";
import { AVISO_SEM_TRANSCRICAO, transcreverAudio, transcricaoDisponivel } from "./transcricao.js";
import { motivoParaIgnorar } from "./filtro.js";
import { ehNumeroDoAviso } from "./aviso-equipe.js";

/**
 * Porta de entrada de tudo que chega do WhatsApp.
 *
 * Responsabilidade: registrar fielmente o que aconteceu e decidir SE o bot deve responder.
 * Quem responde e o responder.ts, depois do debounce.
 */

export async function receberMensagem(msg: MensagemRecebida): Promise<void> {
  // A mesma mensagem pode chegar duas vezes. Registrar em duplicidade bagunca o
  // historico e faz a IA responder duas vezes.
  const jaRegistrada = await db.message.findUnique({ where: { externalId: msg.idExterno } });
  if (jaRegistrada) {
    logger.debug({ idExterno: msg.idExterno }, "mensagem repetida, ignorada");
    return;
  }

  // Nada aqui pode criar contato, card ou linha no historico antes desta checagem.
  const ignorar = motivoParaIgnorar(msg);
  if (ignorar === "sem-conteudo") {
    logger.debug({ tipo: msg.tipo, idExterno: msg.idExterno }, "mensagem sem conteudo, ignorada");
    return;
  }
  if (ignorar === "antiga") {
    logger.info(
      { telefone: msg.telefone, quando: msg.recebidaEm },
      "mensagem antiga demais (historico do numero), ignorada",
    );
    return;
  }

  // O numero que recebe o aviso de "precisa de voce" e de quem atende, nao de cliente:
  // nem o aviso que sai para ele nem a resposta dele entram no atendimento.
  if (ehNumeroDoAviso(msg.telefone, getNegocio().negocio.handoff.avisarNoWhatsapp)) {
    logger.debug({ idExterno: msg.idExterno }, "mensagem do numero de aviso da equipe, ignorada");
    return;
  }

  if (msg.daEquipe) {
    await registrarMensagemDaEquipe(msg);
    return;
  }

  const lead = await garantirLead(msg.telefone, msg.pushName);

  const { texto, transcricao } = await prepararConteudo(msg);

  if (!texto && !transcricao) {
    logger.debug({ tipo: msg.tipo }, "mensagem sem conteudo aproveitavel, ignorada");
    return;
  }

  await db.message.create({
    data: {
      conversationId: lead.conversa.id,
      direction: "IN",
      author: "CONTACT",
      kind: msg.tipo,
      text: texto,
      transcript: transcricao,
      externalId: msg.idExterno,
      createdAt: msg.recebidaEm,
      ...(await guardarArquivo(msg)),
    },
  });

  await db.conversation.update({
    where: { id: lead.conversa.id },
    data: { lastInboundAt: msg.recebidaEm },
  });

  // A pessoa voltou a falar: o follow-up agendado perde o sentido.
  await cancelarFollowup(lead.conversa.id);

  if (lead.conversa.mode !== "BOT") {
    logger.debug({ conversaId: lead.conversa.id }, "conversa com humano, mensagem so registrada");
    return;
  }

  if (lead.conversa.botPausedUntil && lead.conversa.botPausedUntil > new Date()) {
    logger.debug({ conversaId: lead.conversa.id }, "bot pausado, mensagem so registrada");
    return;
  }

  agendarResposta(lead.conversa.id);
}

/**
 * Grava no disco o arquivo que veio com a mensagem, para a caixa de entrada mostrar.
 * Falhar aqui nunca impede a mensagem de ser registrada: sem o arquivo, a conversa
 * ainda mostra o aviso "[a pessoa enviou uma imagem]".
 */
async function guardarArquivo(msg: MensagemRecebida): Promise<{
  mediaPath?: string;
  mediaMime?: string;
  mediaName?: string | null;
  mediaSize?: number;
}> {
  if (!msg.base64) return {};
  try {
    const salva = await salvarMidia(Buffer.from(msg.base64, "base64"), msg.mimetype ?? "", msg.nomeArquivo);
    return {
      mediaPath: salva.arquivo,
      mediaMime: salva.mime,
      mediaName: limparNomeArquivo(msg.nomeArquivo),
      mediaSize: salva.tamanho,
    };
  } catch (e) {
    logger.warn({ err: e, tipo: msg.tipo }, "nao consegui gravar o arquivo da mensagem");
    return {};
  }
}

async function prepararConteudo(
  msg: MensagemRecebida,
): Promise<{ texto: string | null; transcricao: string | null }> {
  if (msg.tipo !== "AUDIO") return { texto: msg.texto, transcricao: null };

  if (!transcricaoDisponivel()) {
    return { texto: "[audio]", transcricao: AVISO_SEM_TRANSCRICAO };
  }

  const transcricao = await transcreverAudio(msg.idExterno, msg.base64, msg.mimetype);
  return {
    texto: "[audio]",
    transcricao: transcricao ?? AVISO_SEM_TRANSCRICAO,
  };
}

/**
 * Mensagem enviada pelo proprio numero do negocio.
 *
 * Pode ser nossa (o bot acabou de mandar) ou do dono respondendo pelo celular.
 * Se foi o dono, o bot cala a boca por um tempo - atropelar o humano no meio do
 * atendimento e o jeito mais rapido de o cliente desinstalar o sistema.
 *
 * REGRA: mensagem que sai NUNCA cria lead. Se ainda nao existe conversa com esse
 * numero, quer dizer que a pessoa nunca escreveu para o negocio — e o dono falando
 * com alguem por conta propria. Sem isto, quem conecta o numero pessoal ve o CRM
 * encher de "leads" que sao a familia, o amigo e o entregador.
 */
async function registrarMensagemDaEquipe(msg: MensagemRecebida): Promise<void> {
  const conversa = await db.conversation.findFirst({
    where: { contact: { phone: { in: variantesTelefone(msg.telefone) } } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (!conversa) {
    logger.debug(
      { telefone: msg.telefone },
      "mensagem enviada para quem nunca escreveu ao negocio, ignorada",
    );
    return;
  }

  const conversaId = conversa.id;
  const texto = msg.texto?.trim();

  // Foi o proprio bot: ja registramos no envio.
  const nossa = await db.message.findFirst({
    where: {
      conversationId: conversaId,
      direction: "OUT",
      author: "BOT",
      text: texto ?? undefined,
      createdAt: { gte: new Date(Date.now() - 90_000) },
    },
  });
  if (nossa) {
    if (!nossa.externalId) {
      await db.message.update({ where: { id: nossa.id }, data: { externalId: msg.idExterno } });
    }
    return;
  }

  const { negocio } = getNegocio();
  const pausaAte = new Date(Date.now() + negocio.handoff.pausaAposHumanoMin * 60_000);

  await db.message.create({
    data: {
      conversationId: conversaId,
      direction: "OUT",
      author: "HUMAN",
      kind: msg.tipo,
      text: texto ?? "[mensagem enviada pela equipe]",
      externalId: msg.idExterno,
      createdAt: msg.recebidaEm,
      ...(await guardarArquivo(msg)),
    },
  });

  await db.conversation.update({
    where: { id: conversaId },
    data: { botPausedUntil: pausaAte, lastOutboundAt: msg.recebidaEm },
  });

  // Se havia resposta do bot a caminho, cancela: o humano ja esta falando.
  cancelarResposta(conversaId);
  await cancelarFollowup(conversaId);

  logger.info(
    { conversaId, pausaAte },
    "alguem da equipe respondeu pelo celular - bot pausado nessa conversa",
  );
}
