import "./preparar.js";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ehEventoDeMensagem, interpretarMensagem } from "../src/whatsapp/payload.js";
import { webhookTexto } from "./fixtures.js";

describe("endereco novo do WhatsApp (LID)", () => {
  // Defeito encontrado no primeiro teste real (17/09/2026): a mensagem chegou de
  // "66782463324204@lid" e esse numero foi guardado como telefone. A IA respondeu
  // para um numero que nao existe — a resposta saiu, ganhou id, e nunca chegou.
  const comLid = (chave: Record<string, unknown>) => ({
    event: "messages.upsert",
    data: {
      key: { id: "ABC", ...chave },
      pushName: "Vitorio",
      messageType: "conversation",
      message: { conversation: "Oi, quanto custa clareamento?" },
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  });

  test("usa o telefone de verdade, nao o LID", () => {
    const msg = interpretarMensagem(
      comLid({ remoteJid: "66782463324204@lid", remoteJidAlt: "5511987654321@s.whatsapp.net" }),
    );
    assert.equal(msg?.telefone, "5511987654321");
  });

  test("LID sem telefone junto e descartado: responder seria mandar para o vazio", () => {
    assert.equal(interpretarMensagem(comLid({ remoteJid: "66782463324204@lid" })), null);
  });

  test("numero normal continua funcionando", () => {
    const msg = interpretarMensagem(comLid({ remoteJid: "5511987654321@s.whatsapp.net" }));
    assert.equal(msg?.telefone, "5511987654321");
  });
});

describe("payload da Evolution", () => {
  test("reconhece o evento de mensagem nas duas grafias", () => {
    assert.equal(ehEventoDeMensagem({ event: "messages.upsert" }), true);
    assert.equal(ehEventoDeMensagem({ event: "MESSAGES_UPSERT" }), true);
    assert.equal(ehEventoDeMensagem({ event: "connection.update" }), false);
  });

  test("interpreta mensagem de texto", () => {
    const msg = interpretarMensagem(webhookTexto("Oi, queria saber sobre lentes"));
    assert.ok(msg);
    assert.equal(msg.telefone, "5511987654321");
    assert.equal(msg.pushName, "Ana Souza");
    assert.equal(msg.tipo, "TEXT");
    assert.equal(msg.texto, "Oi, queria saber sobre lentes");
    assert.equal(msg.daEquipe, false);
  });

  test("interpreta extendedTextMessage (resposta com citacao)", () => {
    const msg = interpretarMensagem(
      webhookTexto("", {
        message: { extendedTextMessage: { text: "Quanto custa o clareamento?" } },
        messageType: "extendedTextMessage",
      }),
    );
    assert.equal(msg?.texto, "Quanto custa o clareamento?");
    assert.equal(msg?.tipo, "TEXT");
  });

  test("interpreta audio e carrega o base64 quando vem no webhook", () => {
    const msg = interpretarMensagem(
      webhookTexto("", {
        message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" }, base64: "QUJD" },
        messageType: "audioMessage",
      }),
    );
    assert.equal(msg?.tipo, "AUDIO");
    assert.equal(msg?.base64, "QUJD");
    assert.equal(msg?.mimetype, "audio/ogg; codecs=opus");
  });

  test("imagem com legenda vira texto; sem legenda vira descricao", () => {
    const comLegenda = interpretarMensagem(
      webhookTexto("", {
        message: { imageMessage: { caption: "meu dente ta assim", mimetype: "image/jpeg" } },
        messageType: "imageMessage",
      }),
    );
    assert.equal(comLegenda?.texto, "meu dente ta assim");

    const semLegenda = interpretarMensagem(
      webhookTexto("", {
        message: { imageMessage: { mimetype: "image/jpeg" } },
        messageType: "imageMessage",
      }),
    );
    // Nunca pode virar null: o atendente precisa reagir a foto em vez de ficar mudo.
    assert.ok(semLegenda?.texto?.includes("imagem"));
  });

  test("documento com legenda traz nome e tamanho do arquivo", () => {
    // Com legenda, o WhatsApp embrulha o documento um nivel abaixo. O tamanho as vezes
    // vem como Long (objeto), nao numero.
    const longo = { toString: () => "20971520" };
    const msg = interpretarMensagem(
      webhookTexto("", {
        message: {
          documentWithCaptionMessage: {
            message: {
              documentMessage: {
                caption: "segue o exame",
                fileName: "Exame de sangue.pdf",
                mimetype: "application/pdf",
                fileLength: longo,
              },
            },
          },
        },
        messageType: "documentWithCaptionMessage",
      }),
    );
    assert.equal(msg?.tipo, "DOCUMENT");
    assert.equal(msg?.texto, "segue o exame");
    assert.equal(msg?.nomeArquivo, "Exame de sangue.pdf");
    assert.equal(msg?.mimetype, "application/pdf");
    assert.equal(msg?.tamanho, 20971520);
  });

  test("marca mensagem enviada pelo proprio numero", () => {
    const msg = interpretarMensagem(
      webhookTexto("Oi Ana, ja te respondo", {
        key: { remoteJid: "5511987654321@s.whatsapp.net", fromMe: true, id: "ABC123" },
      }),
    );
    assert.equal(msg?.daEquipe, true);
  });

  test("ignora grupo e status", () => {
    const grupo = interpretarMensagem(
      webhookTexto("bom dia pessoal", {
        key: { remoteJid: "120363012345678901@g.us", fromMe: false, id: "G1" },
      }),
    );
    assert.equal(grupo, null);

    const status = interpretarMensagem(
      webhookTexto("status", {
        key: { remoteJid: "status@broadcast", fromMe: false, id: "S1" },
      }),
    );
    assert.equal(status, null);
  });

  test("payload quebrado nao derruba o sistema", () => {
    assert.equal(interpretarMensagem({}), null);
    assert.equal(interpretarMensagem({ data: {} }), null);
    assert.equal(interpretarMensagem(null), null);
  });
});
