import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { registrarEnvioDaEquipe } from "../atendimento/envio-da-equipe.js";
import { db } from "../lib/db.js";
import {
  LIMITE_BYTES,
  caminhoDaMidia,
  limparNomeArquivo,
  mimeBase,
  salvarMidia,
  tipoDoArquivo,
} from "../lib/midia.js";
import { logger } from "../lib/logger.js";
import { webmParaOgg } from "../whatsapp/audio-ogg.js";
import { enviarMidia, type MidiaParaEnviar } from "../whatsapp/conexao.js";
import { exigirLogin } from "./api.js";

/**
 * Arquivos nas conversas: mandar foto, documento e audio pelo CRM, e abrir o que chegou.
 *
 * O arquivo sobe como corpo cru (application/octet-stream), com nome e tipo na URL.
 * Evita uma biblioteca de upload so para isso — cada dependencia e peso no build do
 * comprador.
 */

/** O que a IA le no historico quando a equipe manda arquivo sem legenda. */
const AVISO_DA_EQUIPE: Record<MidiaParaEnviar["tipo"], string> = {
  IMAGE: "[a equipe enviou uma foto]",
  VIDEO: "[a equipe enviou um video]",
  AUDIO: "[a equipe enviou um audio]",
  DOCUMENT: "[a equipe enviou um documento]",
};

/** Forma de onda do navegador: 64 numeros de 0 a 100, separados por virgula. */
function lerOnda(texto: string | undefined): Uint8Array | null {
  if (!texto) return null;
  const valores = texto.split(",").map(Number);
  if (valores.length !== 64 || valores.some((v) => !Number.isInteger(v) || v < 0 || v > 100)) {
    return null;
  }
  return Uint8Array.from(valores);
}

export async function rotasMidia(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", exigirLogin);

  // Vale so dentro deste arquivo: o resto da API continua so aceitando JSON.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: LIMITE_BYTES },
    (_req, corpo, pronto) => pronto(null, corpo),
  );

  app.post("/api/conversas/:id/arquivos", async (req, reply) => {
    const { id } = req.params as { id: string };
    const consulta = req.query as {
      nome?: string;
      tipo?: string;
      legenda?: string;
      voz?: string;
      segundos?: string;
      onda?: string;
    };
    const corpo = req.body;

    if (!Buffer.isBuffer(corpo) || corpo.length === 0) {
      return reply.code(400).send({ erro: "O arquivo chegou vazio. Escolha de novo." });
    }

    const conversa = await db.conversation.findUnique({
      where: { id },
      include: { contact: true },
    });
    if (!conversa) return reply.code(404).send({ erro: "Essa conversa não existe mais. Recarregue a página." });

    let conteudo: Buffer = corpo;
    let mime = mimeBase(consulta.tipo) || "application/octet-stream";
    let nome = limparNomeArquivo(consulta.nome);
    const legenda = consulta.legenda?.trim().slice(0, 1000) || null;
    const tipo = tipoDoArquivo(mime) as MidiaParaEnviar["tipo"];
    let voz: MidiaParaEnviar["voz"] = null;

    // Audio gravado no CRM vira mensagem de voz. O Chrome grava em WebM, o WhatsApp
    // so trata como voz em OGG: troca a embalagem aqui (audio-ogg.ts).
    if (consulta.voz === "1" && tipo === "AUDIO") {
      const onda = lerOnda(consulta.onda);
      if (mime === "audio/webm") {
        try {
          const convertido = webmParaOgg(corpo);
          conteudo = convertido.ogg;
          mime = "audio/ogg";
          voz = { segundos: convertido.segundos, onda };
        } catch (e) {
          // Nao converteu: manda como arquivo de audio, que ainda toca.
          logger.warn({ err: e }, "nao consegui converter o audio gravado para mensagem de voz");
        }
      } else if (mime === "audio/ogg") {
        // O Firefox ja grava em OGG.
        voz = { segundos: Math.max(1, Math.round(Number(consulta.segundos) || 1)), onda };
      }
      nome = null;
    }

    try {
      const { id: idExterno } = await enviarMidia(conversa.contact.phone, {
        tipo,
        conteudo,
        mime,
        nome,
        legenda,
        voz,
      });

      const salva = await salvarMidia(conteudo, mime, nome);
      await db.message.create({
        data: {
          conversationId: id,
          direction: "OUT",
          author: "HUMAN",
          kind: tipo,
          text: legenda ?? AVISO_DA_EQUIPE[tipo],
          externalId: idExterno ?? null,
          mediaPath: salva.arquivo,
          mediaMime: salva.mime,
          mediaName: nome,
          mediaSize: salva.tamanho,
        },
      });

      await registrarEnvioDaEquipe(id);
      return { ok: true };
    } catch (e) {
      logger.error({ err: e, conversaId: id, tipo }, "falha ao enviar arquivo pelo CRM");
      return reply.code(502).send({
        erro: "O arquivo não foi enviado. Confira se o WhatsApp está conectado na tela de Conexão.",
      });
    }
  });

  app.get("/api/midia/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { baixar } = req.query as { baixar?: string };

    const mensagem = await db.message.findUnique({
      where: { id },
      select: { mediaPath: true, mediaMime: true, mediaName: true },
    });
    const caminho = mensagem?.mediaPath ? caminhoDaMidia(mensagem.mediaPath) : null;
    if (!mensagem || !caminho) return reply.code(404).send({ erro: "Arquivo não encontrado." });

    let tamanho: number;
    try {
      tamanho = (await stat(caminho)).size;
    } catch {
      return reply
        .code(404)
        .send({ erro: "O arquivo não está mais neste computador. Veja no celular." });
    }

    const nome = mensagem.mediaName ?? mensagem.mediaPath!;
    const mime = mensagem.mediaMime ?? "application/octet-stream";
    // Abre no navegador so o que e seguro de abrir. Qualquer outra coisa (HTML, SVG,
    // planilha) baixa, mesmo que o dono clique para ver.
    const podeAbrir =
      /^(image\/(jpeg|png|webp|gif)|audio\/|video\/)/.test(mime) || mime === "application/pdf";
    const modo = baixar === "1" || !podeAbrir ? "attachment" : "inline";
    reply
      .header("Content-Type", mime)
      .header("Content-Length", tamanho)
      // Nome com acento precisa da forma codificada; a outra fica para navegador antigo.
      .header(
        "Content-Disposition",
        `${modo}; filename="${nome.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      )
      // Arquivo de conversa nao muda: pode ficar no navegador, mas so no dele.
      .header("Cache-Control", "private, max-age=86400")
      // O navegador nao pode "adivinhar" que um documento e pagina e roda-lo no CRM.
      .header("X-Content-Type-Options", "nosniff");
    // O leitor de PDF do navegador quebra com politica restrita; o resto nunca executa nada.
    if (mime !== "application/pdf") {
      reply.header("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'");
    }

    return reply.send(createReadStream(caminho));
  });
}
