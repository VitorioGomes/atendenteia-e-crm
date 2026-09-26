import type { Mensagem } from "./api";
import { hora } from "./formato";
import { MidiaDaMensagem } from "./midia";

/**
 * Uma mensagem da conversa. Usado no painel do lead e na caixa de entrada — mesma
 * conversa, mesma aparência nas duas telas.
 *
 * Quem falou fica sempre à vista: a pessoa à esquerda, a IA e a equipe à direita,
 * com a equipe em outra cor. Numa conversa em que a IA e um humano se revezam, o
 * dono precisa saber de relance o que foi dito por quem.
 */
export function Balao({ mensagem }: { mensagem: Mensagem }) {
  const entrada = mensagem.direction === "IN";
  const ehAudio = mensagem.kind === "AUDIO";
  const midia = mensagem.midia ?? null;
  const figurinha = mensagem.kind === "STICKER" && midia;

  // No áudio, o texto que importa é a transcrição; no resto, a legenda ou a mensagem.
  const texto = ehAudio ? (mensagem.transcript ?? (midia ? null : mensagem.text)) : mensagem.text;

  const classes = [
    "balao",
    entrada ? "entrada" : "saida",
    mensagem.author === "HUMAN" ? "humana" : "",
    ehAudio ? "audio" : "",
    midia ? `com-midia midia-${mensagem.kind.toLowerCase()}` : "",
    figurinha ? "figurinha" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const quem = mensagem.author === "BOT" ? "IA" : mensagem.author === "HUMAN" ? "você" : null;

  return (
    <div className={classes}>
      {midia ? (
        <MidiaDaMensagem midia={midia} tipo={mensagem.kind} />
      ) : (
        ehAudio && <span className="marca-audio">áudio transcrito</span>
      )}

      {texto &&
        (midia && ehAudio ? (
          <span className="transcricao">
            <span className="rotulo">Transcrição</span>
            {texto}
          </span>
        ) : (
          <span className="texto">{texto}</span>
        ))}

      <span className="assinatura">
        {quem ? `${quem}, ` : ""}
        {hora(mensagem.createdAt)}
      </span>
    </div>
  );
}
