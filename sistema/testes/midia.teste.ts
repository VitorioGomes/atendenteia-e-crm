import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { caminhoDaMidia, limparNomeArquivo, mimeBase, tipoDoArquivo } from "../src/lib/midia.js";
import { ehAvisoParaIa, mensagemParaTela, previaDaMensagem } from "../src/http/mensagem.js";

describe("arquivos das conversas", () => {
  it("cada arquivo vira o tipo de mensagem certo no WhatsApp", () => {
    assert.equal(tipoDoArquivo("image/jpeg"), "IMAGE");
    assert.equal(tipoDoArquivo("video/mp4"), "VIDEO");
    assert.equal(tipoDoArquivo("audio/ogg; codecs=opus"), "AUDIO");
    assert.equal(tipoDoArquivo("application/pdf"), "DOCUMENT");
    // O WhatsApp nao mostra SVG como foto.
    assert.equal(tipoDoArquivo("image/svg+xml"), "DOCUMENT");
  });

  it("tira parametros do tipo", () => {
    assert.equal(mimeBase("audio/ogg; codecs=opus"), "audio/ogg");
    assert.equal(mimeBase(null), "");
  });

  it("nome de arquivo de fora nao carrega caminho, mas guarda o acento", () => {
    assert.equal(limparNomeArquivo("C:\\Users\\x\\Orçamento.pdf"), "Orçamento.pdf");
    assert.equal(limparNomeArquivo("../../etc/passwd"), "passwd");
    assert.equal(limparNomeArquivo('a"b.pdf'), "ab.pdf");
    assert.equal(limparNomeArquivo("   "), null);
  });

  it("nao abre arquivo fora da pasta de midia", () => {
    assert.ok(caminhoDaMidia("m1abc-0a1b2c3d4e5f.jpg"));
    assert.equal(caminhoDaMidia("../crm.db"), null);
    assert.equal(caminhoDaMidia("..\\crm.db"), null);
  });
});

describe("mensagem com arquivo na tela", () => {
  const base = {
    id: "m1",
    direction: "IN",
    author: "CONTACT",
    kind: "IMAGE",
    transcript: null,
    createdAt: new Date(),
    mediaMime: "image/jpeg",
    mediaName: null,
    mediaSize: 1000,
  };

  it("o aviso para a IA some quando a foto esta la", () => {
    const m = mensagemParaTela({ ...base, text: "[a pessoa enviou uma imagem sem legenda]", mediaPath: "x.jpg" });
    assert.equal(m.text, null);
    assert.equal(m.midia?.url, "/api/midia/m1");
  });

  it("sem o arquivo (grande demais, falhou), o aviso fica: e o que resta", () => {
    const m = mensagemParaTela({ ...base, text: "[a pessoa enviou um video]", mediaPath: null });
    assert.equal(m.text, "[a pessoa enviou um video]");
    assert.equal(m.midia, null);
  });

  it("legenda de verdade continua", () => {
    const m = mensagemParaTela({ ...base, text: "meu dente ta assim", mediaPath: "x.jpg" });
    assert.equal(m.text, "meu dente ta assim");
  });

  it("previa na lista diz o que e", () => {
    assert.equal(previaDaMensagem({ kind: "IMAGE", text: "[a pessoa enviou uma imagem sem legenda]" }), "Foto");
    assert.equal(previaDaMensagem({ kind: "IMAGE", text: "olha isso" }), "Foto: olha isso");
    assert.equal(previaDaMensagem({ kind: "AUDIO", text: "[audio]" }), "Áudio");
    assert.equal(previaDaMensagem({ kind: "TEXT", text: "oi" }), "oi");
    assert.ok(ehAvisoParaIa("[a equipe enviou um documento]"));
    assert.ok(!ehAvisoParaIa("[urgente] preciso remarcar"));
  });
});
