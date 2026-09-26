import { db } from "../lib/db.js";
import { cancelarResposta } from "./buffer.js";
import { cancelarFollowup } from "./followup.js";

/**
 * Alguem da equipe acabou de mandar mensagem pelo CRM (texto, foto, audio...).
 * Quem escreveu foi gente: a IA nao volta a responder nessa conversa sem ser mandada.
 */
export async function registrarEnvioDaEquipe(conversaId: string): Promise<void> {
  cancelarResposta(conversaId);
  await cancelarFollowup(conversaId);
  await db.conversation.update({
    where: { id: conversaId },
    data: { mode: "HUMAN", lastOutboundAt: new Date() },
  });
}
