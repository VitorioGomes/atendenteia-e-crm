/**
 * Converte o audio gravado no navegador (WebM) para o formato de mensagem de voz do
 * WhatsApp (OGG). Sem ffmpeg.
 *
 * Por que existe: o Chrome e o Edge gravam em WebM, e o WhatsApp so mostra o audio
 * como "mensagem de voz" (a bolinha com a onda, que toca direto) quando ele chega em
 * OGG/Opus. Mandado em WebM, aparece como arquivo — e no iPhone as vezes nem toca.
 *
 * Nao e conversao de verdade, e troca de embalagem: o som dentro dos dois e Opus,
 * byte a byte o mesmo. Por isso cabe em codigo proprio. A alternativa seria o ffmpeg,
 * um programa a mais para o comprador instalar — e a Regra de ouro nº 1 manda nao.
 *
 * Referencias: Matroska/EBML (RFC 8794), Ogg (RFC 3533), Ogg Opus (RFC 7845),
 * tabela de duracao dos pacotes Opus (RFC 6716, secao 3.1).
 */

export interface AudioOgg {
  ogg: Buffer;
  segundos: number;
}

// ---------------------------------------------------------------------------
// Leitura do WebM
// ---------------------------------------------------------------------------

const ID = {
  segment: 0x18538067,
  cluster: 0x1f43b675,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  audio: 0xe1,
  blockGroup: 0xa0,
  trackNumber: 0xd7,
  codecId: 0x86,
  codecPrivate: 0x63a2,
  channels: 0x9f,
  simpleBlock: 0xa3,
  block: 0xa1,
};

/** Elementos que so agrupam outros: a leitura entra neles em vez de pular. */
const CONTEINERES = new Set([
  ID.segment,
  ID.cluster,
  ID.tracks,
  ID.trackEntry,
  ID.audio,
  ID.blockGroup,
]);

interface Numero {
  valor: number;
  tamanho: number;
  desconhecido: boolean;
}

/** Numero de tamanho variavel do EBML. O primeiro bit 1 diz quantos bytes ele ocupa. */
function lerVint(buf: Buffer, pos: number, manterMarcador: boolean): Numero | null {
  const primeiro = buf[pos];
  if (primeiro === undefined || primeiro === 0) return null;

  let tamanho = 1;
  while (tamanho <= 8 && !(primeiro & (0x80 >> (tamanho - 1)))) tamanho++;
  if (tamanho > 8 || pos + tamanho > buf.length) return null;

  let valor = manterMarcador ? primeiro : primeiro & (0xff >> tamanho);
  let todosUm = valor === 0xff >> tamanho;
  for (let i = 1; i < tamanho; i++) {
    const b = buf[pos + i]!;
    valor = valor * 256 + b;
    if (b !== 0xff) todosUm = false;
  }

  return { valor, tamanho, desconhecido: !manterMarcador && todosUm };
}

interface Trilha {
  numero: number;
  codec: string;
  cabecalho: Buffer | null;
  canais: number;
}

function lerWebm(buf: Buffer): { trilhas: Trilha[]; blocos: { trilha: number; dados: Buffer }[] } {
  const trilhas: Trilha[] = [];
  const blocos: { trilha: number; dados: Buffer }[] = [];
  let trilha: Trilha | null = null;
  let pos = 0;

  while (pos < buf.length) {
    const id = lerVint(buf, pos, true);
    if (!id) break;
    const tam = lerVint(buf, pos + id.tamanho, false);
    if (!tam) break;
    const inicio = pos + id.tamanho + tam.tamanho;

    // O Chrome grava ao vivo, sem saber o tamanho final: Segment e Cluster chegam com
    // tamanho "desconhecido". Como a leitura e plana, basta entrar neles.
    if (CONTEINERES.has(id.valor)) {
      if (id.valor === ID.trackEntry) {
        trilha = { numero: 0, codec: "", cabecalho: null, canais: 1 };
        trilhas.push(trilha);
      }
      pos = inicio;
      continue;
    }

    if (tam.desconhecido) throw new Error("webm: elemento sem tamanho fora de conteiner");
    const fim = inicio + tam.valor;
    if (fim > buf.length) break; // gravacao cortada no fim: aproveita o que veio inteiro
    const conteudo = buf.subarray(inicio, fim);

    if (id.valor === ID.trackNumber && trilha) trilha.numero = lerInteiro(conteudo);
    else if (id.valor === ID.codecId && trilha) trilha.codec = conteudo.toString("latin1");
    else if (id.valor === ID.codecPrivate && trilha) trilha.cabecalho = Buffer.from(conteudo);
    else if (id.valor === ID.channels && trilha) trilha.canais = lerInteiro(conteudo);
    else if (id.valor === ID.simpleBlock || id.valor === ID.block) {
      const numTrilha = lerVint(conteudo, 0, false);
      if (!numTrilha) throw new Error("webm: bloco sem trilha");
      const flags = conteudo[numTrilha.tamanho + 2] ?? 0;
      // Lacing junta varios pacotes num bloco. Nem Chrome nem Firefox usam para Opus;
      // se aparecer, melhor recusar do que mandar audio picotado.
      if (flags & 0x06) throw new Error("webm: bloco com lacing nao suportado");
      blocos.push({
        trilha: numTrilha.valor,
        dados: Buffer.from(conteudo.subarray(numTrilha.tamanho + 3)),
      });
    }

    pos = fim;
  }

  return { trilhas, blocos };
}

function lerInteiro(b: Buffer): number {
  let v = 0;
  for (const byte of b) v = v * 256 + byte;
  return v;
}

// ---------------------------------------------------------------------------
// Opus
// ---------------------------------------------------------------------------

/** Quantas amostras (a 48 kHz) o pacote Opus produz. RFC 6716, 3.1. */
export function amostrasDoPacote(pacote: Buffer): number {
  const toc = pacote[0];
  if (toc === undefined) return 0;

  const config = toc >> 3;
  let decimosDeMs: number;
  if (config < 12) decimosDeMs = [100, 200, 400, 600][config % 4]!;
  else if (config < 16) decimosDeMs = [100, 200][config % 2]!;
  else decimosDeMs = [25, 50, 100, 200][config % 4]!;

  const c = toc & 0x03;
  const quadros = c === 0 ? 1 : c === 3 ? (pacote[1] ?? 0) & 0x3f : 2;

  return (quadros * decimosDeMs * 48) / 10;
}

function cabecalhoOpusPadrao(canais: number): Buffer {
  const b = Buffer.alloc(19);
  b.write("OpusHead", 0, "latin1");
  b[8] = 1; // versao
  b[9] = canais;
  b.writeUInt16LE(312, 10); // pre-skip tipico do encoder
  b.writeUInt32LE(48000, 12);
  b.writeInt16LE(0, 16); // ganho
  b[18] = 0; // mapeamento de canais
  return b;
}

function etiquetasOpus(): Buffer {
  const fornecedor = Buffer.from("atendente-crm", "latin1");
  const b = Buffer.alloc(8 + 4 + fornecedor.length + 4);
  b.write("OpusTags", 0, "latin1");
  b.writeUInt32LE(fornecedor.length, 8);
  fornecedor.copy(b, 12);
  b.writeUInt32LE(0, 12 + fornecedor.length); // nenhum comentario
  return b;
}

// ---------------------------------------------------------------------------
// Escrita do OGG
// ---------------------------------------------------------------------------

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** CRC do Ogg: polinomio 0x04C11DB7, sem reflexao, comecando em zero. */
export function crcOgg(dados: Buffer): number {
  let crc = 0;
  for (const b of dados) crc = ((crc << 8) ^ TABELA_CRC[((crc >>> 24) ^ b) & 0xff]!) >>> 0;
  return crc;
}

const SERIAL = 0x41544443; // fixo: um arquivo, uma trilha

function pagina(
  pacotes: Buffer[],
  granulo: number,
  sequencia: number,
  tipo: number,
): Buffer {
  const lacos: number[] = [];
  for (const p of pacotes) {
    let resto = p.length;
    while (resto >= 255) {
      lacos.push(255);
      resto -= 255;
    }
    lacos.push(resto); // termina em < 255, mesmo que seja 0: e o que marca o fim do pacote
  }

  const cabecalho = Buffer.alloc(27 + lacos.length);
  cabecalho.write("OggS", 0, "latin1");
  cabecalho[4] = 0;
  cabecalho[5] = tipo;
  cabecalho.writeBigInt64LE(BigInt(granulo), 6);
  cabecalho.writeUInt32LE(SERIAL, 14);
  cabecalho.writeUInt32LE(sequencia, 18);
  cabecalho.writeUInt32LE(0, 22);
  cabecalho[26] = lacos.length;
  lacos.forEach((l, i) => (cabecalho[27 + i] = l));

  const inteira = Buffer.concat([cabecalho, ...pacotes]);
  inteira.writeUInt32LE(crcOgg(inteira), 22);
  return inteira;
}

const INICIO = 0x02;
const FIM = 0x04;
/** Uma pagina tem no maximo 255 lacos; um pacote de voz ocupa 1. */
const MAX_LACOS = 250;

export function webmParaOgg(webm: Buffer): AudioOgg {
  const { trilhas, blocos } = lerWebm(webm);
  const opus = trilhas.find((t) => t.codec === "A_OPUS");
  if (!opus) throw new Error("webm: o audio nao esta em Opus");

  const pacotes = blocos.filter((b) => b.trilha === opus.numero).map((b) => b.dados);
  if (pacotes.length === 0) throw new Error("webm: gravacao vazia");

  const cabecalho =
    opus.cabecalho?.subarray(0, 8).toString("latin1") === "OpusHead"
      ? opus.cabecalho
      : cabecalhoOpusPadrao(opus.canais);
  const preSkip = cabecalho.readUInt16LE(10);

  const paginas: Buffer[] = [
    pagina([cabecalho], 0, 0, INICIO),
    pagina([etiquetasOpus()], 0, 1, 0),
  ];

  // O granulo de cada pagina e a contagem de amostras ate o ultimo pacote dela,
  // contando o pre-skip. E dele que o player tira a duracao.
  let granulo = 0;
  let atual: Buffer[] = [];
  let lacos = 0;

  const fechar = (ultima: boolean) => {
    paginas.push(pagina(atual, granulo, paginas.length, ultima ? FIM : 0));
    atual = [];
    lacos = 0;
  };

  pacotes.forEach((p, i) => {
    const lacosDoPacote = Math.floor(p.length / 255) + 1;
    if (atual.length && lacos + lacosDoPacote > MAX_LACOS) fechar(false);
    atual.push(p);
    lacos += lacosDoPacote;
    granulo += amostrasDoPacote(p);
    if (i === pacotes.length - 1) fechar(true);
  });

  return {
    ogg: Buffer.concat(paginas),
    segundos: Math.max(1, Math.round((granulo - preSkip) / 48000)),
  };
}
