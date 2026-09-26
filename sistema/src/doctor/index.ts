import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { env, urlPublica } from "../config/env.js";
import { numeroDoAviso } from "../atendimento/aviso-equipe.js";
import { ErroDeConfiguracao, carregarNegocio } from "../config/negocio.js";
import { db, fecharDb } from "../lib/db.js";
import { transcricaoDisponivel } from "../atendimento/transcricao.js";
import { estadoConexao, sessaoExiste } from "../whatsapp/conexao.js";

/**
 * Diagnostico.
 *
 * Este arquivo e o produto tanto quanto o atendente. Quando algo nao funciona, o comprador
 * roda um comando e recebe, em portugues, o que esta errado E o que fazer. E tambem o que o
 * Claude Code dele le para consertar sozinho.
 *
 * Regra: nenhuma mensagem daqui pode terminar sem dizer o proximo passo.
 */

type Nivel = "ok" | "aviso" | "erro";

interface Resultado {
  nome: string;
  nivel: Nivel;
  detalhe: string;
  comoResolver?: string;
}

const resultados: Resultado[] = [];

/**
 * O mesmo diagnostico roda no PC (npm run doctor, na pasta do projeto) e na VPS (dentro
 * do Docker). O jeito de reiniciar e o backup sao diferentes nos dois; antes o PC
 * recebia instrucao de VPS ("docker compose restart app"), que la nao existe.
 */
const naVps = env.NODE_ENV === "production";
const REINICIAR = naVps
  ? "rode: docker compose restart app"
  : "pare o sistema com Ctrl+C e rode npm run pc de novo";

function registrar(r: Resultado): void {
  resultados.push(r);
  const marca = r.nivel === "ok" ? "[ OK ]" : r.nivel === "aviso" ? "[AVISO]" : "[ERRO]";
  console.log(`${marca} ${r.nome}`);
  console.log(`       ${r.detalhe}`);
  if (r.comoResolver) console.log(`       -> ${r.comoResolver}`);
  console.log("");
}

async function verificarNegocio(): Promise<boolean> {
  try {
    const config = await carregarNegocio();
    const n = config.negocio;
    registrar({
      nome: "Configuracao do negocio",
      nivel: "ok",
      detalhe:
        `${n.negocio.nome} | atendente: ${n.atendente.nome} | ` +
        `${n.funil.estagios.length} estagios | ${n.servicos.length} servicos | ` +
        `conhecimento: ${config.conhecimento.length} caracteres`,
    });

    if (config.conhecimento.trim().length < 200) {
      registrar({
        nome: "Base de conhecimento",
        nivel: "aviso",
        detalhe: "O arquivo conhecimento.md esta vazio ou muito curto.",
        comoResolver:
          "A IA so sabe o que estiver la. Escreva perguntas frequentes, objecoes e politicas " +
          `em negocio/conhecimento.md e ${REINICIAR}`,
      });
    }

    if (!numeroDoAviso(n.handoff.avisarNoWhatsapp)) {
      registrar({
        nome: "Aviso quando a IA chama a equipe",
        nivel: "aviso",
        detalhe:
          "Nenhum numero configurado. Quando a IA passar uma conversa, so o CRM fica sabendo.",
        comoResolver:
          "Coloque o WhatsApp pessoal de quem atende em handoff.avisarNoWhatsapp, no " +
          "negocio/negocio.json, e ligue o sistema de novo.",
      });
    }
    return true;
  } catch (e) {
    registrar({
      nome: "Configuracao do negocio",
      nivel: "erro",
      detalhe: e instanceof ErroDeConfiguracao ? e.message : String(e),
      comoResolver: `Corrija o arquivo negocio/negocio.json e ${REINICIAR}`,
    });
    return false;
  }
}

async function verificarBanco(): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    const estagios = await db.stage.count();
    const contatos = await db.contact.count();
    const negocios = await db.deal.count();

    registrar({
      nome: "Banco de dados",
      nivel: "ok",
      detalhe: `Conectado. ${estagios} estagios, ${contatos} contatos, ${negocios} cards.`,
    });

    if (estagios === 0) {
      registrar({
        nome: "Funil do CRM",
        nivel: "erro",
        detalhe: "Nenhum estagio no banco.",
        comoResolver:
          `O funil e criado na inicializacao: ${REINICIAR} e veja o que aparece no terminal.`,
      });
      return false;
    }
    return true;
  } catch (e) {
    registrar({
      nome: "Banco de dados",
      nivel: "erro",
      detalhe: `Nao consegui conectar: ${(e as Error).message}`,
      comoResolver:
        "O banco e um arquivo em dados/crm.db. Confira se a pasta dados/ existe e se o " +
        "sistema tem permissao de escrita nela.",
    });
    return false;
  }
}

async function verificarWhatsapp(): Promise<void> {
  if (!sessaoExiste()) {
    registrar({
      nome: "WhatsApp",
      nivel: "erro",
      detalhe: "Nenhum numero conectado ainda.",
      comoResolver:
        `Abra ${urlPublica} , clique em "Conectar WhatsApp" e leia o QR Code no celular: ` +
        "WhatsApp > Dispositivos conectados > Conectar dispositivo.",
    });
    return;
  }

  const estado = estadoConexao();
  if (estado === "open") {
    registrar({ nome: "WhatsApp", nivel: "ok", detalhe: "Conectado." });
    return;
  }

  // O doctor roda num processo separado do servidor, entao ele nao ve a conexao
  // viva — so sabe que existe sessao salva. Dizer "desconectado" aqui seria mentira.
  registrar({
    nome: "WhatsApp",
    nivel: "aviso",
    detalhe: "Existe um numero conectado, mas quem sabe se a conexao esta de pe e o servidor.",
    comoResolver:
      `Confira o sinal no rodape do CRM em ${urlPublica} . Se estiver vermelho, ` +
      "leia o QR Code de novo na tela de Conexao.",
  });
}

async function verificarIA(): Promise<void> {
  try {
    const cliente = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const resposta = await cliente.messages.create({
      model: env.LLM_MODEL,
      max_tokens: 8,
      messages: [{ role: "user", content: "responda apenas: ok" }],
    });
    const texto = resposta.content.find((b) => b.type === "text");
    registrar({
      nome: "Inteligencia artificial",
      nivel: "ok",
      detalhe: `Modelo ${env.LLM_MODEL} respondeu ("${texto?.type === "text" ? texto.text.trim() : ""}").`,
    });
  } catch (e) {
    const erro = e as { status?: number; message?: string };
    const ajuda =
      erro.status === 401
        ? "A chave em ANTHROPIC_API_KEY esta errada ou foi revogada. Gere outra em " +
          "https://console.anthropic.com e atualize o .env"
        : erro.status === 400
          ? `O modelo "${env.LLM_MODEL}" foi recusado. Verifique LLM_MODEL no .env ` +
            "(o padrao e claude-haiku-4-5)."
          : erro.status === 429
            ? "Limite de uso atingido ou sem credito. Verifique o saldo no console da Anthropic."
            : "Verifique sua internet e a chave em ANTHROPIC_API_KEY no .env";

    registrar({
      nome: "Inteligencia artificial",
      nivel: "erro",
      detalhe: `Falhou: ${erro.message ?? String(e)}`,
      comoResolver: ajuda,
    });
  }
}

function verificarTranscricao(): void {
  if (transcricaoDisponivel()) {
    registrar({
      nome: "Transcricao de audio",
      nivel: "ok",
      detalhe: "Configurada. Audios recebidos serao transcritos e respondidos normalmente.",
    });
  } else {
    registrar({
      nome: "Transcricao de audio",
      nivel: "aviso",
      detalhe: "Nao configurada. Se mandarem audio, a IA vai pedir para a pessoa escrever.",
      comoResolver:
        "No Brasil muita gente manda audio. Para ativar, coloque uma chave da OpenAI em " +
        `OPENAI_API_KEY no .env e ${REINICIAR}`,
    });
  }
}

/**
 * O backup roda por cron, fora do sistema. Se ele parar, ninguem percebe —
 * ate o dia em que precisar restaurar. Por isso o diagnostico cobra.
 */
function verificarBackup(): void {
  // No PC nao ha cron de backup: a copia e a pasta dados/, e a mudanca para a VPS leva
  // tudo junto. Cobrar backup ali so gera um aviso que ninguem consegue resolver.
  if (!naVps) return;
  const pasta = path.resolve("./backups");

  let arquivos: string[];
  try {
    arquivos = readdirSync(pasta).filter(
      (f) => f.startsWith("atendente-") && f.endsWith(".tar.gz"),
    );
  } catch {
    registrar({
      nome: "Backup",
      nivel: "aviso",
      detalhe: "Nao consegui ler a pasta de backups.",
      comoResolver:
        "Rode uma vez na mao para conferir que funciona: bash backup.sh " +
        "(de dentro da pasta do sistema, na VPS)",
    });
    return;
  }

  if (arquivos.length === 0) {
    registrar({
      nome: "Backup",
      nivel: "erro",
      detalhe: "NAO EXISTE NENHUM BACKUP. Se esta VPS morrer agora, voce perde tudo.",
      comoResolver: "Faca um agora: bash backup.sh — e confira o agendamento com: crontab -l",
    });
    return;
  }

  let maisRecente = 0;
  for (const arquivo of arquivos) {
    try {
      const idade = statSync(path.join(pasta, arquivo)).mtimeMs;
      if (idade > maisRecente) maisRecente = idade;
    } catch {
      /* arquivo sumiu no meio da leitura; ignora */
    }
  }

  const horas = Math.floor((Date.now() - maisRecente) / 3_600_000);

  if (horas > 48) {
    registrar({
      nome: "Backup",
      nivel: "erro",
      detalhe: `O backup mais recente tem ${Math.floor(horas / 24)} dias. O agendamento parou.`,
      comoResolver:
        "Confira o agendamento com 'crontab -l' e o motivo da falha em backups/backup.log. " +
        "Para gerar um agora: bash backup.sh",
    });
    return;
  }

  registrar({
    nome: "Backup",
    nivel: "ok",
    detalhe:
      `${arquivos.length} copia(s) guardada(s), a mais recente de ` +
      `${horas < 1 ? "menos de 1 hora" : `${horas} hora(s)`} atras.`,
  });
}

async function mostrarConsumo(): Promise<void> {
  const registro = await db.setting.findUnique({ where: { key: "uso_llm" } });
  const uso = (registro?.value as Record<string, number> | undefined) ?? {};
  if (!uso.chamadas) return;

  console.log("-".repeat(70));
  console.log(" Consumo da IA ate agora");
  console.log(`   chamadas ............. ${uso.chamadas}`);
  console.log(`   tokens de entrada .... ${uso.entrada ?? 0}`);
  console.log(`   tokens de saida ...... ${uso.saida ?? 0}`);
  console.log(`   lidos do cache ....... ${uso.cacheLido ?? 0}`);
  const total = (uso.entrada ?? 0) + (uso.cacheLido ?? 0);
  if (total > 0) {
    const aproveitamento = Math.round(((uso.cacheLido ?? 0) / total) * 100);
    console.log(`   aproveitamento cache . ${aproveitamento}%`);
    if (aproveitamento < 30 && (uso.chamadas ?? 0) > 5) {
      console.log("   ATENCAO: cache baixo. Isso encarece a conta. Reporte esse numero no suporte.");
    }
  }
  console.log("");
}

async function principal(): Promise<void> {
  console.log("");
  console.log("=".repeat(70));
  console.log(" DIAGNOSTICO DO ATENDENTE + CRM");
  console.log("=".repeat(70));
  console.log("");

  const configOk = await verificarNegocio();
  const bancoOk = await verificarBanco();
  await verificarWhatsapp();
  await verificarIA();
  verificarTranscricao();
  verificarBackup();
  if (bancoOk) await mostrarConsumo();

  const erros = resultados.filter((r) => r.nivel === "erro").length;
  const avisos = resultados.filter((r) => r.nivel === "aviso").length;

  console.log("=".repeat(70));
  if (erros === 0 && avisos === 0) {
    console.log(" TUDO CERTO. Manda uma mensagem no seu WhatsApp pra testar.");
  } else if (erros === 0) {
    console.log(` FUNCIONANDO, com ${avisos} ponto(s) de atencao acima.`);
  } else {
    console.log(` ${erros} PROBLEMA(S) encontrado(s). Resolva os itens [ERRO] acima, de cima pra baixo.`);
  }
  console.log("=".repeat(70));
  console.log("");

  await fecharDb();
  process.exit(erros > 0 || !configOk ? 1 : 0);
}

principal().catch(async (e) => {
  console.error("O diagnostico falhou de forma inesperada:", e);
  await fecharDb().catch(() => {});
  process.exit(1);
});
