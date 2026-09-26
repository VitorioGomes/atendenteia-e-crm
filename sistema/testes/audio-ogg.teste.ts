import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { amostrasDoPacote, crcOgg, webmParaOgg } from "../src/whatsapp/audio-ogg.js";

/**
 * O audio gravado no CRM so chega como "mensagem de voz" no WhatsApp se for OGG.
 * A amostra e uma gravacao de 3 segundos feita pelo MediaRecorder do Edge (Chromium), com o
 * microfone falso do navegador (um bipe, sem voz de ninguem: o arquivo vai para o repositorio publico),
 * o mesmo caminho do dono clicando no microfone. Se a conversao quebrar, o audio ainda
 * sai, mas como arquivo — e no iPhone pode nem tocar.
 */

const webm = readFileSync(new URL("./amostras/gravacao-navegador.webm", import.meta.url));

interface Pagina {
  tipo: number;
  granulo: bigint;
  sequencia: number;
  crcOk: boolean;
  pacotes: Buffer[];
}

/** Leitor de OGG independente do escritor, para conferir o arquivo gerado. */
function lerPaginas(ogg: Buffer): Pagina[] {
  const paginas: Pagina[] = [];
  let pos = 0;
  while (pos < ogg.length) {
    assert.equal(ogg.toString("latin1", pos, pos + 4), "OggS", `pagina ${paginas.length} sem assinatura`);
    const nLacos = ogg[pos + 26]!;
    const lacos = [...ogg.subarray(pos + 27, pos + 27 + nLacos)];
    const tamanho = 27 + nLacos + lacos.reduce((a, b) => a + b, 0);
    const bruta = Buffer.from(ogg.subarray(pos, pos + tamanho));
    const crc = bruta.readUInt32LE(22);
    bruta.writeUInt32LE(0, 22);

    const pacotes: Buffer[] = [];
    let atual: number[] = [];
    let dados = pos + 27 + nLacos;
    for (const l of lacos) {
      atual.push(...ogg.subarray(dados, dados + l));
      dados += l;
      if (l < 255) {
        pacotes.push(Buffer.from(atual));
        atual = [];
      }
    }

    paginas.push({
      tipo: ogg[pos + 5]!,
      granulo: ogg.readBigInt64LE(pos + 6),
      sequencia: ogg.readUInt32LE(pos + 18),
      crcOk: crcOgg(bruta) === crc,
      pacotes,
    });
    pos += tamanho;
  }
  return paginas;
}

describe("gravacao do navegador vira mensagem de voz", () => {
  const { ogg, segundos } = webmParaOgg(webm);
  const paginas = lerPaginas(ogg);

  it("tem a duracao da gravacao", () => {
    assert.equal(segundos, 3);
  });

  it("comeca com os cabecalhos do Opus, na ordem do padrao", () => {
    assert.equal(paginas[0]!.pacotes[0]!.toString("latin1", 0, 8), "OpusHead");
    assert.equal(paginas[1]!.pacotes[0]!.toString("latin1", 0, 8), "OpusTags");
    assert.equal(paginas[0]!.tipo, 0x02, "primeira pagina marca o inicio");
    assert.equal(paginas.at(-1)!.tipo, 0x04, "ultima pagina marca o fim");
  });

  it("toda pagina tem CRC valido e numeracao em sequencia", () => {
    paginas.forEach((p, i) => {
      assert.ok(p.crcOk, `CRC errado na pagina ${i}`);
      assert.equal(p.sequencia, i);
    });
  });

  it("o granulo nunca volta e fecha na duracao", () => {
    let anterior = 0n;
    for (const p of paginas) {
      assert.ok(p.granulo >= anterior);
      anterior = p.granulo;
    }
    const preSkip = paginas[0]!.pacotes[0]!.readUInt16LE(10);
    const duracao = Number(anterior - BigInt(preSkip)) / 48000;
    assert.ok(Math.abs(duracao - 3) < 0.1, `duracao ${duracao}s`);
  });

  it("nao perde nenhum pacote de audio", () => {
    const pacotes = paginas.slice(2).flatMap((p) => p.pacotes);
    const amostras = pacotes.reduce((soma, p) => soma + amostrasDoPacote(p), 0);
    assert.equal(BigInt(amostras), paginas.at(-1)!.granulo);
  });
});

describe("recusa o que nao sabe converter", () => {
  it("arquivo que nao e WebM", () => {
    assert.throws(() => webmParaOgg(Buffer.from("isto nao e audio")));
  });

  it("gravacao cortada no meio ainda aproveita o que veio inteiro", () => {
    const { segundos } = webmParaOgg(webm.subarray(0, Math.floor(webm.length * 0.6)));
    assert.ok(segundos >= 1 && segundos <= 2);
  });
});

describe("duracao de cada pacote Opus (RFC 6716)", () => {
  it("CELT de 20 ms, um quadro: 960 amostras", () => {
    assert.equal(amostrasDoPacote(Buffer.from([(31 << 3) | 0])), 960);
  });
  it("SILK de 60 ms, dois quadros: 5760", () => {
    assert.equal(amostrasDoPacote(Buffer.from([(3 << 3) | 1])), 5760);
  });
  it("contagem explicita de quadros (codigo 3)", () => {
    assert.equal(amostrasDoPacote(Buffer.from([(31 << 3) | 3, 3])), 2880);
  });
});
