import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import type { ConfigNegocio } from "../config/negocio.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { definirFerramentas, executarFerramenta, novosEfeitos } from "./ferramentas.js";
import type { ContextoFerramentas, Efeitos } from "./ferramentas.js";
import { montarSystem } from "./prompt.js";
import type { EstadoDoLead } from "./prompt.js";

const cliente = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

/** Quantas mensagens anteriores entram no contexto. */
const HISTORICO = 30;
/** Teto de idas e voltas com ferramentas numa unica resposta. */
const MAX_RODADAS = 5;

export interface RespostaDoAgente {
  texto: string;
  efeitos: Efeitos;
  uso: { entrada: number; saida: number; cacheLido: number; cacheEscrito: number };
}

/**
 * Monta o historico no formato da API.
 *
 * A API exige alternancia user/assistant, mas no WhatsApp a pessoa manda 4 mensagens
 * seguidas o tempo todo - entao mensagens consecutivas do mesmo lado sao juntadas.
 */
async function montarHistorico(conversaId: string): Promise<Anthropic.MessageParam[]> {
  const registros = await db.message.findMany({
    where: { conversationId: conversaId },
    orderBy: { createdAt: "desc" },
    take: HISTORICO,
    select: { direction: true, author: true, text: true, transcript: true, kind: true },
  });

  const mensagens: Anthropic.MessageParam[] = [];

  for (const m of registros.reverse()) {
    const conteudo = (m.transcript ?? m.text ?? "").trim();
    if (!conteudo) continue;

    const papel: "user" | "assistant" = m.direction === "IN" ? "user" : "assistant";
    // Mensagem enviada por um humano da equipe entra como se fosse do assistente:
    // pro modelo, e a "nossa" fala anterior naquela conversa.
    const texto =
      m.kind === "AUDIO" && m.transcript ? `[audio transcrito] ${conteudo}` : conteudo;

    const ultima = mensagens.at(-1);
    if (ultima && ultima.role === papel && typeof ultima.content === "string") {
      ultima.content = `${ultima.content}\n${texto}`;
    } else {
      mensagens.push({ role: papel, content: texto });
    }
  }

  // A conversa tem que comecar com o usuario.
  while (mensagens.length && mensagens[0]?.role === "assistant") mensagens.shift();

  return mensagens;
}

async function contabilizarUso(uso: RespostaDoAgente["uso"]): Promise<void> {
  // Guardado para responder a pergunta que todo comprador faz: "quanto isso me custa?"
  const chave = "uso_llm";
  const atual = await db.setting.findUnique({ where: { key: chave } });
  const acumulado = (atual?.value as Record<string, number> | undefined) ?? {};

  await db.setting.upsert({
    where: { key: chave },
    create: {
      key: chave,
      value: {
        entrada: uso.entrada,
        saida: uso.saida,
        cacheLido: uso.cacheLido,
        cacheEscrito: uso.cacheEscrito,
        chamadas: 1,
      },
    },
    update: {
      value: {
        entrada: (acumulado.entrada ?? 0) + uso.entrada,
        saida: (acumulado.saida ?? 0) + uso.saida,
        cacheLido: (acumulado.cacheLido ?? 0) + uso.cacheLido,
        cacheEscrito: (acumulado.cacheEscrito ?? 0) + uso.cacheEscrito,
        chamadas: (acumulado.chamadas ?? 0) + 1,
      },
    },
  });
}

export async function pensarEResponder(
  config: ConfigNegocio,
  lead: EstadoDoLead,
  ctx: ContextoFerramentas,
): Promise<RespostaDoAgente> {
  const system = montarSystem(config, lead);
  const ferramentas = definirFerramentas(config);
  const mensagens = await montarHistorico(ctx.conversaId);

  if (!mensagens.length) {
    return {
      texto: "",
      efeitos: novosEfeitos(),
      uso: { entrada: 0, saida: 0, cacheLido: 0, cacheEscrito: 0 },
    };
  }

  const efeitos = novosEfeitos();
  const uso = { entrada: 0, saida: 0, cacheLido: 0, cacheEscrito: 0 };
  const rodadas: RodadaDeTexto[] = [];

  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    // Sem `thinking`: o padrao e Haiku 4.5 (que nao pensa por padrao) e num atendimento
    // de WhatsApp latencia vale mais que raciocinio profundo.
    const resposta = await cliente.messages.create({
      model: env.LLM_MODEL,
      max_tokens: 1024,
      system,
      tools: ferramentas,
      messages: mensagens,
    });

    uso.entrada += resposta.usage.input_tokens;
    uso.saida += resposta.usage.output_tokens;
    uso.cacheLido += resposta.usage.cache_read_input_tokens ?? 0;
    uso.cacheEscrito += resposta.usage.cache_creation_input_tokens ?? 0;

    rodadas.push({
      textos: resposta.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text" && b.text.trim() !== "")
        .map((b) => b.text.trim()),
      ferramentas: resposta.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => b.name),
    });

    if (resposta.stop_reason !== "tool_use") break;

    const chamadas = resposta.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!chamadas.length) break;

    mensagens.push({ role: "assistant", content: resposta.content });

    // Ferramentas em paralelo, resultados TODOS na mesma mensagem de usuario:
    // separar em mensagens diferentes ensina o modelo a parar de chamar em paralelo.
    const resultados = await Promise.all(
      chamadas.map(async (chamada) => {
        const saida = await executarFerramenta(chamada.name, chamada.input, ctx, efeitos);
        // A entrada vai junto: sem ela, "nao ha horario livre em 2025-09-27" levou uma
        // investigacao para descobrir que o erro era o ano que o modelo mandou.
        logger.debug(
          { ferramenta: chamada.name, entrada: chamada.input, saida },
          "ferramenta executada",
        );
        return {
          type: "tool_result" as const,
          tool_use_id: chamada.id,
          content: saida,
        };
      }),
    );

    mensagens.push({ role: "user", content: resultados });
  }

  await contabilizarUso(uso).catch((e) => logger.warn({ err: e }, "falha ao contabilizar uso"));

  if (uso.cacheLido === 0 && uso.cacheEscrito === 0) {
    logger.warn(
      "o cache do prompt nao esta pegando - isso multiplica o custo. " +
        "Verifique se o bloco estavel do prompt mudou entre as chamadas.",
    );
  }

  return { texto: textoParaEnviar(rodadas), efeitos, uso };
}

/** O que a IA escreveu numa rodada, e quais ferramentas ela chamou junto. */
export interface RodadaDeTexto {
  textos: string[];
  ferramentas: string[];
}

/**
 * Ferramentas cujo resultado muda o que se pode dizer ao cliente. Texto escrito na
 * mesma rodada que uma delas foi escrito ANTES de saber o resultado.
 *
 * transferir_humano entrou no teste 2: a IA escreveu "Vou confirmar com a equipe" junto
 * com a chamada e, depois do resultado, "Deixa eu passar para a equipe". O cliente
 * recebeu o mesmo aviso duas vezes.
 */
const FERRAMENTAS_QUE_MUDAM_A_RESPOSTA = new Set([
  "consultar_horarios",
  "agendar",
  "remarcar_agendamento",
  "cancelar_agendamento",
  "transferir_humano",
]);

/**
 * O texto que vai para o WhatsApp.
 *
 * Antes, ia o texto de TODAS as rodadas. Entao o que a IA escrevia junto com a chamada
 * da agenda, antes de ver o resultado, saia para o cliente como mensagem de verdade:
 * "Deixa eu ver se temos esse horario disponivel" (teste de 22/09/2026). A regra no
 * prompt pedia para nao narrar, mas nada impedia a frase de ser enviada.
 *
 * Agora texto escrito na mesma rodada de uma dessas ferramentas nao sai: ou e
 * narracao, ou e palpite sobre disponibilidade feito antes de consultar. So se a IA
 * nao disser mais nada depois, esse texto e usado, para nunca mandar resposta vazia.
 *
 * Texto que acompanha ferramenta de registro (atualizar_lead, resumo, estagio) sai
 * normalmente: ali a resposta ja esta pronta e a ferramenta so anota o que aconteceu.
 */
export function textoParaEnviar(rodadas: RodadaDeTexto[]): string {
  const antecipado = (r: RodadaDeTexto) => r.ferramentas.some((f) => FERRAMENTAS_QUE_MUDAM_A_RESPOSTA.has(f));

  const valido = rodadas.filter((r) => !antecipado(r)).flatMap((r) => r.textos);
  const escolhido = valido.length ? valido : rodadas.flatMap((r) => r.textos);

  return escolhido.join("\n\n").trim();
}
