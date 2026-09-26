import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type AnyMessageContent,
  type WAMessage,
  type WASocket,
} from "baileys";
import QRCode from "qrcode";
import { logger } from "../lib/logger.js";
import { LIMITE_BYTES } from "../lib/midia.js";
import type { TipoMensagem } from "../lib/estados.js";
import { jidParaTelefone, normalizarTelefone } from "../lib/telefone.js";
import { receberMensagem } from "../atendimento/caixa-entrada.js";
import { ehEventoDeMensagem, interpretarMensagem } from "./payload.js";

/**
 * Conexao com o WhatsApp, pelo Baileys, dentro do proprio processo.
 *
 * Substituiu a Evolution API em 17/09/2026. Motivo: a Evolution e um servidor separado
 * que exige Docker, e o caminho padrao do produto passou a ser o computador do comprador
 * (Regra de ouro nº 3). A Evolution era construida em cima desta mesma biblioteca, entao
 * o protocolo e o risco de ban sao os mesmos — o que sai e uma peca de infraestrutura.
 *
 * O que este arquivo assumiu, e que antes era da Evolution: reconectar sozinho, guardar a
 * sessao, gerar o QR Code e baixar a midia. O resto do sistema nao mudou: continua
 * chamando enviarTexto(), marcarDigitando(), estadoConexao() e obterQrCode().
 *
 * Nao existe mais webhook: a mensagem chega como evento, aqui dentro.
 */

export type EstadoConexao = "open" | "connecting" | "close" | "desconhecido";

export interface RespostaQrCode {
  /** PNG em data-uri, pronto pra exibir no CRM. */
  base64?: string;
  /** Texto cru do QR, caso o CRM prefira desenhar do lado dele. */
  code?: string;
}

/** Onde fica a sessao. Dentro de dados/ porque e o que o backup copia. */
const PASTA_SESSAO = path.resolve(process.cwd(), "dados", "whatsapp");

const registro = logger.child({ modulo: "whatsapp" });
/**
 * O Baileys fala muito: cada recibo, cada notificacao do protocolo vira linha. Solto,
 * ele enterra "CRM disponivel em http://localhost:3000" e o comprador acha que travou.
 * So aviso e erro dele chegam ao terminal.
 */
const registroBaileys = registro.child({}, { level: "warn" });

/** Mensagens cujo arquivo vale baixar. Figurinha entra: aparece como imagem. */
const TIPOS_COM_ARQUIVO = new Set<TipoMensagem>(["AUDIO", "IMAGE", "VIDEO", "DOCUMENT", "STICKER"]);

let socket: WASocket | null = null;
let estado: EstadoConexao = "close";
let qrAtual: string | null = null;
let qrPng: string | null = null;
let conectando: Promise<void> | null = null;
/** Desligado de proposito pelo dono: nao reconectar sozinho. */
let desligadoDeProposito = false;
/**
 * Cada socket ganha um numero. O Baileys nao remove os ouvintes de um socket morto,
 * entao um socket antigo continua disparando "connection.update" depois de trocado.
 * Sem isto, cada zumbi agenda a propria reconexao e a coisa vira avalanche: no teste
 * real de 20/09/2026 foram 20 conexoes para 52 quedas em dois minutos e meio.
 */
let geracao = 0;
/** Reconexoes seguidas sem conseguir abrir. Zera quando abre. */
let tentativas = 0;
/** So pode existir um relogio de reconexao. */
let relogioReconexao: NodeJS.Timeout | null = null;
/** Por que paramos de tentar. A tela de Conexao mostra isto para o dono. */
let motivoParado: string | null = null;

/** Comeca em 5s e dobra ate 5 minutos: insistir de 5 em 5s por horas e abuso. */
const ESPERA_INICIAL_MS = 5_000;
const ESPERA_MAXIMA_MS = 5 * 60_000;
/** Depois disso o problema nao e passageiro, e insistir so gasta o numero do dono. */
const MAX_TENTATIVAS = 8;
/** Quando a conexao atual abriu. A tela mostra "conectado ha 3 dias". */
let conectadoDesde: Date | null = null;
/** Foto do perfil em data-uri. O link do WhatsApp expira, entao guarda o conteudo. */
let fotoCache: { jid: string; foto: string | null; em: number } | null = null;
const VALIDADE_FOTO_MS = 6 * 3_600_000;

// ---------------------------------------------------------------------------
// Conexao
// ---------------------------------------------------------------------------

async function abrirSocket(): Promise<void> {
  await mkdir(PASTA_SESSAO, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);

  // A versao do protocolo muda sem aviso. Se nao der para consultar (sem internet,
  // por exemplo), o Baileys usa a que veio no pacote em vez de travar o boot.
  let version: [number, number, number] | undefined;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (e) {
    registro.warn({ err: e }, "nao consegui consultar a versao do WhatsApp, usando a do pacote");
  }

  estado = "connecting";

  socket = makeWASocket({
    auth: state,
    version,
    logger: registroBaileys,
    // Aparece na lista "Aparelhos conectados" do celular do dono. Ele precisa
    // reconhecer o que e isso meses depois, para nao desconectar por engano.
    browser: Browsers.ubuntu("Atendente IA"),
    // NAO marcar como online: se marcar, o celular do dono para de receber
    // notificacao das mensagens, e ele acha que o sistema roubou o WhatsApp dele.
    markOnlineOnConnect: false,
    // Historico antigo nao interessa e custa memoria e tempo de sincronizacao.
    syncFullHistory: false,
    // Grupo nao entra: atendimento comercial acontece no privado, e responder em
    // grupo e o caminho mais curto para o numero ser denunciado.
    shouldIgnoreJid: (jid) => jid.endsWith("@g.us") || jid === "status@broadcast",
  });

  const minhaGeracao = ++geracao;
  const meuSocket = socket;

  socket.ev.on("creds.update", () => void saveCreds());

  socket.ev.on("connection.update", (u) => {
    // Evento de socket ja substituido: ignorar. Ver o comentario de "geracao".
    if (minhaGeracao !== geracao) return;

    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      qrAtual = qr;
      // O CRM mostra uma imagem; gerar aqui evita mais uma biblioteca no front.
      QRCode.toDataURL(qr, { margin: 1, width: 320 })
        .then((png) => (qrPng = png))
        .catch((e) => registro.warn({ err: e }, "nao consegui desenhar o QR Code"));
      estado = "connecting";
      motivoParado = null;
      registro.info("QR Code novo disponivel na tela de Conexao");
    }

    if (connection === "open") {
      estado = "open";
      conectadoDesde = new Date();
      qrAtual = null;
      qrPng = null;
      desligadoDeProposito = false;
      tentativas = 0;
      motivoParado = null;
      registro.info({ numero: socket?.user?.id }, "WhatsApp conectado");
    }

    if (connection === "close") {
      estado = "close";
      conectadoDesde = null;

      // Dereferenciar nao fecha nada: o websocket do socket antigo continua aberto
      // e o Baileys continua tentando por ele. Fechar de verdade e o que evita
      // duas conexoes vivas com a mesma credencial.
      try {
        meuSocket.end(undefined);
      } catch {
        /* ja estava fechado */
      }
      socket = null;

      // O erro vem como Boom, que e dependencia do Baileys e nao nossa: ler o
      // campo direto evita depender de uma biblioteca de terceiro por tabela.
      const motivo = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode;

      const acao = acaoAoCair({ motivo, desligadoDeProposito, tentativasAnteriores: tentativas });

      if (acao.tipo === "limpar_sessao") {
        registro.warn({ motivo }, "WhatsApp desconectado — e preciso ler o QR Code de novo");
        parar(acao.motivo);
        void limparSessao();
        return;
      }

      if (acao.tipo === "parar") {
        registro.warn({ motivo, tentativas }, "parei de tentar reconectar");
        parar(acao.motivo);
        return;
      }

      if (acao.tipo === "nada") {
        registro.info("WhatsApp desligado pelo CRM");
        return;
      }

      if (acao.contaTentativa) tentativas += 1;
      registro.warn({ motivo, tentativas, espera: acao.emMs }, "conexao caiu, reconectando");
      agendarReconexao(acao.emMs);
    }
  });

  socket.ev.on("messages.upsert", (evento) => {
    // "append" e historico sendo sincronizado; so "notify" e mensagem chegando agora.
    if (evento.type !== "notify") return;

    for (const mensagem of evento.messages) {
      // Sem await: uma mensagem lenta nao pode segurar a proxima.
      void tratarMensagem(mensagem).catch((e) =>
        registro.error({ err: e }, "falha ao tratar mensagem recebida"),
      );
    }
  });
}

/**
 * Abre a conexao. Pode ser chamada varias vezes: se ja existe uma tentativa em
 * andamento, espera a mesma em vez de abrir uma segunda sessao.
 */
export async function conectar(): Promise<void> {
  if (socket && estado === "open") return;
  if (conectando) return conectando;

  conectando = abrirSocket().finally(() => {
    conectando = null;
  });
  return conectando;
}

/** O que fazer depois de a conexao cair. */
export type AcaoDaQueda =
  | { tipo: "limpar_sessao"; motivo: string }
  | { tipo: "parar"; motivo: string }
  | { tipo: "reconectar"; emMs: number; contaTentativa: boolean }
  | { tipo: "nada" };

/**
 * A politica de reconexao, separada do socket para poder ser testada.
 *
 * Ela existe porque a versao antiga reconectava em tudo que nao fosse "deslogado",
 * inclusive no 440 ("outro aparelho assumiu esta sessao"). Reconectar ali e revidar:
 * cada lado derruba o outro, sem fim. No teste real de 20/09/2026 deu 20 conexoes
 * para 52 quedas em dois minutos e meio — e esse vai-e-vem e justamente o padrao que
 * faz a Meta banir um numero. Quem decide quem fica com a conexao e o dono, na tela.
 */
export function acaoAoCair(entrada: {
  /** Codigo do DisconnectReason. Indefinido quando o WhatsApp nao disse. */
  motivo?: number;
  desligadoDeProposito: boolean;
  /** Quedas seguidas ANTES desta. Zera quando a conexao abre. */
  tentativasAnteriores: number;
}): AcaoDaQueda {
  const { motivo, tentativasAnteriores } = entrada;

  // A credencial morreu: so um QR Code novo resolve, insistir nao adianta.
  if (motivo === DisconnectReason.loggedOut || motivo === DisconnectReason.forbidden) {
    return {
      tipo: "limpar_sessao",
      motivo: "O WhatsApp foi desconectado. Leia o QR Code de novo para reconectar.",
    };
  }

  if (motivo === DisconnectReason.connectionReplaced) {
    return {
      tipo: "parar",
      motivo:
        "Outro aparelho assumiu esta conexao do WhatsApp. Desconecte o sistema nos " +
        "outros aparelhos e leia o QR Code de novo aqui.",
    };
  }

  // Desligar pelo CRM e pedido do dono, nao falha.
  if (entrada.desligadoDeProposito) return { tipo: "nada" };

  // 515 faz parte do pareamento: o WhatsApp manda reiniciar logo depois do QR Code.
  // Nao e falha, entao nao conta tentativa e nao espera.
  if (motivo === DisconnectReason.restartRequired) {
    return { tipo: "reconectar", emMs: 200, contaTentativa: false };
  }

  if (tentativasAnteriores + 1 > MAX_TENTATIVAS) {
    return {
      tipo: "parar",
      motivo: "Nao consegui reconectar ao WhatsApp. Confira a internet e leia o QR Code de novo.",
    };
  }

  // Queda de rede, reinicio do WhatsApp, troca de servidor: tenta de novo, cada vez
  // esperando o dobro. Insistir de 5 em 5 segundos por horas e abuso do numero.
  return {
    tipo: "reconectar",
    emMs: Math.min(ESPERA_INICIAL_MS * 2 ** tentativasAnteriores, ESPERA_MAXIMA_MS),
    contaTentativa: true,
  };
}

/**
 * Para de tentar e guarda o motivo para a tela mostrar. Existir um motivo e a
 * diferenca entre "esta fora do ar" e "esta fora do ar por isto, faca aquilo":
 * sem ele o dono so ve um QR Code que nao conecta e nao sabe o que fazer.
 */
function parar(motivo: string): void {
  if (relogioReconexao) {
    clearTimeout(relogioReconexao);
    relogioReconexao = null;
  }
  tentativas = 0;
  motivoParado = motivo;
}

/** Um relogio de reconexao por vez: dois viram duas sessoes vivas. */
function agendarReconexao(ms: number): void {
  if (relogioReconexao) clearTimeout(relogioReconexao);
  relogioReconexao = setTimeout(() => {
    relogioReconexao = null;
    void conectar().catch((e) => registro.error({ err: e }, "falha ao reconectar"));
  }, ms);
}

async function limparSessao(): Promise<void> {
  try {
    await rm(PASTA_SESSAO, { recursive: true, force: true });
  } catch (e) {
    registro.warn({ err: e }, "nao consegui apagar a sessao antiga");
  }
}

// ---------------------------------------------------------------------------
// Recebimento
// ---------------------------------------------------------------------------

async function tratarMensagem(bruta: WAMessage): Promise<void> {
  // O parser continua sendo o mesmo da epoca da Evolution: ela so repassava o
  // formato do Baileys. Por isso a mensagem entra embrulhada no mesmo envelope.
  const envelope = { event: "messages.upsert", data: bruta };
  if (!ehEventoDeMensagem(envelope)) return;

  const mensagem = interpretarMensagem(envelope);
  if (!mensagem) {
    // Mensagem descartada em silencio e suporte impossivel. O caso que importa: LID
    // sem o telefone junto — nao da para responder, e o dono precisa saber por que
    // aquele lead nao apareceu.
    const jid = bruta.key?.remoteJid ?? "";
    if (jid.endsWith("@lid") && !bruta.key?.remoteJidAlt) {
      registro.warn(
        { jid },
        "mensagem chegou por LID sem o telefone junto; nao da para responder, entao foi ignorada",
      );
    }
    return;
  }

  // Baixa aqui, uma vez, enquanto a mensagem ainda esta fresca: a chave de midia
  // expira. O audio precisa do conteudo para transcrever; foto, video e documento,
  // para aparecer na caixa de entrada.
  if (TIPOS_COM_ARQUIVO.has(mensagem.tipo)) {
    if (mensagem.tamanho !== null && mensagem.tamanho > LIMITE_BYTES) {
      registro.info(
        { tipo: mensagem.tipo, tamanho: mensagem.tamanho },
        "arquivo grande demais para baixar; fica so o aviso na conversa",
      );
    } else {
      mensagem.base64 = await baixarMidia(bruta);
    }
  }

  await receberMensagem(mensagem);
}

async function baixarMidia(bruta: WAMessage): Promise<string | null> {
  try {
    const buffer = await downloadMediaMessage(
      bruta,
      "buffer",
      {},
      { logger: registroBaileys, reuploadRequest: socket!.updateMediaMessage },
    );
    return Buffer.isBuffer(buffer) ? buffer.toString("base64") : null;
  } catch (e) {
    registro.warn({ err: e }, "nao consegui baixar a midia da mensagem");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

const jid = (telefone: string) => `${normalizarTelefone(telefone)}@s.whatsapp.net`;

function exigirSocket(): WASocket {
  if (!socket || estado !== "open") {
    throw new Error(
      "O WhatsApp nao esta conectado. Abra a tela de Conexao no CRM e leia o QR Code.",
    );
  }
  return socket;
}

export async function enviarTexto(telefone: string, texto: string): Promise<{ id?: string }> {
  const enviada = await exigirSocket().sendMessage(jid(telefone), { text: texto });
  return { id: enviada?.key?.id ?? undefined };
}

export interface MidiaParaEnviar {
  tipo: "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";
  conteudo: Buffer;
  mime: string;
  nome?: string | null;
  legenda?: string | null;
  /** Mensagem de voz: so quando o audio ja esta em OGG/Opus (ver audio-ogg.ts). */
  voz?: { segundos: number; onda: Uint8Array | null } | null;
}

export async function enviarMidia(
  telefone: string,
  midia: MidiaParaEnviar,
): Promise<{ id?: string }> {
  const legenda = midia.legenda?.trim() || undefined;
  let conteudo: AnyMessageContent;

  if (midia.tipo === "IMAGE") {
    conteudo = { image: midia.conteudo, mimetype: midia.mime, caption: legenda };
  } else if (midia.tipo === "VIDEO") {
    conteudo = { video: midia.conteudo, mimetype: midia.mime, caption: legenda };
  } else if (midia.tipo === "AUDIO") {
    // Duracao e onda vao prontas: sem elas o Baileys tenta calcular com bibliotecas
    // que nao instalamos, e a mensagem de voz chega sem as barrinhas no celular.
    conteudo = midia.voz
      ? {
          audio: midia.conteudo,
          mimetype: "audio/ogg; codecs=opus",
          ptt: true,
          seconds: midia.voz.segundos,
          ...(midia.voz.onda ? { waveform: midia.voz.onda } : {}),
        }
      : { audio: midia.conteudo, mimetype: midia.mime };
  } else {
    conteudo = {
      document: midia.conteudo,
      mimetype: midia.mime || "application/octet-stream",
      fileName: midia.nome ?? "arquivo",
      caption: legenda,
    };
  }

  const enviada = await exigirSocket().sendMessage(jid(telefone), conteudo);
  return { id: enviada?.key?.id ?? undefined };
}

/** Mostra "digitando..." pro contato. E o que faz o atendimento parecer humano. */
export async function marcarDigitando(telefone: string, _duracaoMs: number): Promise<void> {
  try {
    const s = exigirSocket();
    const destino = jid(telefone);
    await s.presenceSubscribe(destino);
    await s.sendPresenceUpdate("composing", destino);
  } catch (e) {
    // Falhar em mostrar "digitando" nunca pode impedir a resposta de sair.
    registro.debug({ err: e }, "nao consegui enviar presenca de digitacao");
  }
}

// ---------------------------------------------------------------------------
// Estado, usado pela tela de Conexao e pelo doctor
// ---------------------------------------------------------------------------

export function estadoConexao(): EstadoConexao {
  return estado;
}

/**
 * Por que a conexao parou, em portugues e com o que fazer. Null quando esta tudo
 * bem ou quando ainda esta tentando sozinho.
 */
export function motivoDaParada(): string | null {
  return motivoParado;
}

export interface ContaConectada {
  telefone: string;
  nome: string | null;
  /** data-uri; null quando a conta esconde a foto ou nao tem. */
  foto: string | null;
  desde: Date | null;
}

/**
 * Qual numero esta conectado. Com dois chips na mesa, "conectado" nao basta: o dono
 * precisa ver que e o numero do atendimento, e nao o pessoal.
 */
export async function contaConectada(): Promise<ContaConectada | null> {
  const usuario = socket?.user;
  if (!socket || estado !== "open" || !usuario?.id) return null;

  const telefone = jidParaTelefone(usuario.id);
  const jidLimpo = `${telefone}@s.whatsapp.net`;
  const nome =
    usuario.name ?? (usuario as { verifiedName?: string }).verifiedName ?? usuario.notify ?? null;

  return { telefone, nome, foto: await fotoDoPerfil(jidLimpo), desde: conectadoDesde };
}

async function fotoDoPerfil(jid: string): Promise<string | null> {
  if (fotoCache && fotoCache.jid === jid && Date.now() - fotoCache.em < VALIDADE_FOTO_MS) {
    return fotoCache.foto;
  }
  let foto: string | null = null;
  try {
    const url = await socket?.profilePictureUrl(jid, "image");
    if (url) {
      const resposta = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (resposta.ok) {
        const tipo = resposta.headers.get("content-type") ?? "image/jpeg";
        const bytes = Buffer.from(await resposta.arrayBuffer());
        foto = `data:${tipo};base64,${bytes.toString("base64")}`;
      }
    }
  } catch (e) {
    // Sem foto (privacidade do perfil, sem internet): a tela usa as iniciais.
    registro.debug({ err: e }, "nao consegui buscar a foto do perfil conectado");
  }
  fotoCache = { jid, foto, em: Date.now() };
  return foto;
}

/** Ja existe sessao salva? Serve pro doctor dizer se falta ler o QR Code. */
export function sessaoExiste(): boolean {
  return existsSync(path.join(PASTA_SESSAO, "creds.json"));
}

export async function obterQrCode(): Promise<RespostaQrCode> {
  // Sem sessao e sem socket, ninguem gerou QR ainda: abre a conexao para gerar.
  if (estado !== "open" && !socket && !conectando) {
    await conectar();
  }
  return { base64: qrPng ?? undefined, code: qrAtual ?? undefined };
}

/** Desconecta e apaga a sessao: o proximo acesso exige QR Code novo. */
export async function desconectar(): Promise<void> {
  desligadoDeProposito = true;
  try {
    await socket?.logout();
  } catch (e) {
    registro.warn({ err: e }, "falha ao desconectar; apagando a sessao mesmo assim");
  }
  socket = null;
  estado = "close";
  qrAtual = null;
  qrPng = null;
  await limparSessao();
}

/**
 * Chamado no boot. Se ja ha sessao salva, reconecta sozinho; se nao ha, deixa o
 * sistema de pe e espera alguem ler o QR Code na tela de Conexao.
 */
export async function prepararConexao(): Promise<EstadoConexao> {
  await conectar();
  return estado;
}
