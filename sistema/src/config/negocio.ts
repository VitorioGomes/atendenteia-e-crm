import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { env } from "./env.js";

/**
 * O contrato entre a skill e o sistema.
 *
 * A skill entrevista o comprador e escreve negocio.json seguindo este schema.
 * Qualquer coisa que mude de negocio para negocio tem que caber aqui - se nao couber,
 * o certo e adicionar um campo, nunca gerar codigo sob medida.
 */

const HoraSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use o formato HH:MM, ex.: 09:00");
const IntervaloSchema = z.tuple([HoraSchema, HoraSchema]);

const DiasSchema = z.object({
  seg: z.array(IntervaloSchema).default([]),
  ter: z.array(IntervaloSchema).default([]),
  qua: z.array(IntervaloSchema).default([]),
  qui: z.array(IntervaloSchema).default([]),
  sex: z.array(IntervaloSchema).default([]),
  sab: z.array(IntervaloSchema).default([]),
  dom: z.array(IntervaloSchema).default([]),
});

export const NegocioSchema = z.object({
  negocio: z.object({
    nome: z.string().min(1),
    segmento: z.string().default(""),
    descricaoCurta: z.string().default(""),
    cidade: z.string().default(""),
    endereco: z.string().default(""),
    comoChegar: z.string().default(""),
    site: z.string().default(""),
    instagram: z.string().default(""),
  }),

  atendente: z.object({
    nome: z.string().min(1),
    genero: z.enum(["feminino", "masculino", "neutro"]).default("neutro"),
    cargo: z.string().default("assistente de atendimento"),
    tom: z.string().default("cordial e objetivo"),
    emojis: z.enum(["nenhum", "poucos", "muitos"]).default("poucos"),
    tamanhoResposta: z.enum(["curto", "medio", "longo"]).default("curto"),
    seApresenta: z.boolean().default(true),
    /**
     * Politica de preco. Decisao de negocio, entao e config e nao codigo: clinica
     * fecha valor na avaliacao, loja fala preco na hora. O padrao e o conservador,
     * porque valor solto antes de a pessoa dizer o que quer vira negociacao antes
     * de existir interesse.
     */
    falarDePreco: z.enum(["so_se_perguntarem", "pode_falar", "nunca"]).default("so_se_perguntarem"),
    regras: z.array(z.string()).default([]),
    naoFaz: z.array(z.string()).default([]),
  }),

  // Horario da EQUIPE (e de quando da para marcar). A IA atende 24h e nunca anuncia
  // que esta "fora do horario" — isso existiu ate 18/09/2026 e fazia a pessoa se sentir
  // atendida de favor. Os antigos responderForaDoHorario e mensagemForaDoHorario sairam;
  // se aparecerem num negocio.json velho, sao ignorados.
  horarios: z.object({
    timezone: z.string().default(env.TIMEZONE),
    atendimento: DiasSchema,
  }),

  objetivo: z.object({
    principal: z.string().min(1),
    explicacao: z.string().default(""),
    perguntasQualificacao: z
      .array(
        z.object({
          campo: z.string().min(1),
          pergunta: z.string().min(1),
          obrigatorio: z.boolean().default(false),
        }),
      )
      .default([]),
  }),

  funil: z.object({
    estagios: z
      .array(
        z.object({
          chave: z
            .string()
            .regex(/^[a-z0-9_]+$/, "use apenas letras minusculas, numeros e _ (ex.: novo_lead)"),
          nome: z.string().min(1),
          quandoMover: z.string().default(""),
          ganho: z.boolean().default(false),
          perdido: z.boolean().default(false),
          /**
           * Estagio de "tem horario marcado". O SISTEMA move para ca quando um
           * agendamento e criado de verdade (pela IA ou pelo CRM), e tira daqui quando
           * ele e cancelado. A IA nao move para ca na mao.
           *
           * Existe porque regra em texto nao segura modelo: no primeiro teste real
           * (18/09/2026) a IA moveu o card para "Avaliacao agendada" com o motivo
           * "esta pronto para agendar" — e nenhum agendamento existia.
           */
          aoAgendar: z.boolean().default(false),
          /** So a equipe move para ca (ex.: "compareceu"). A IA nao enxerga a opcao. */
          somenteEquipe: z.boolean().default(false),
          /**
           * Estagio de "a pessoa veio". O SISTEMA move para ca quando alguem marca o
           * agendamento como "Compareceu" na Agenda, e tira daqui se a marcacao for
           * desfeita. A IA nunca move para ca. Sem isso o dono marcava "compareceu" e o
           * card ficava parado em "agendado" (achado de 18/09/2026).
           */
          aoComparecer: z.boolean().default(false),
        }),
      )
      .min(2, "o funil precisa de pelo menos 2 estagios")
      .refine((estagios) => estagios.filter((e) => e.aoAgendar).length <= 1, {
        message: 'so um estagio pode ter "aoAgendar": true',
      })
      .refine((estagios) => estagios.filter((e) => e.aoComparecer).length <= 1, {
        message: 'so um estagio pode ter "aoComparecer": true',
      }),
  }),

  servicos: z
    .array(
      z.object({
        nome: z.string().min(1),
        descricao: z.string().default(""),
        preco: z.string().default(""),
        duracaoMin: z.number().int().positive().default(60),
        agendavel: z.boolean().default(false),
        observacao: z.string().default(""),
      }),
    )
    .default([]),

  agenda: z
    .object({
      ativo: z.boolean().default(false),
      duracaoPadraoMin: z.number().int().positive().default(60),
      antecedenciaMinimaHoras: z.number().int().min(0).default(2),
      janelaDias: z.number().int().positive().default(30),
      intervaloSlotsMin: z.number().int().positive().default(30),
      atendimentosSimultaneos: z.number().int().positive().default(1),

      /**
       * Lembrete antes do compromisso. Falta e o maior ralo de dinheiro de
       * clinica, e a mensagem de vespera e o que mais reduz isso.
       */
      lembrete: z
        .object({
          ativo: z.boolean().default(true),
          horasAntes: z.number().positive().default(24),
          instrucao: z
            .string()
            .default(
              "Lembre a pessoa do compromisso de forma curta e simpatica, e peca que ela " +
                "confirme se vem. Se disser que nao pode, ofereca remarcar.",
            ),
        })
        .default({}),
    })
    .default({}),

  followup: z
    .object({
      ativo: z.boolean().default(false),
      maxTentativas: z.number().int().min(0).max(10).default(3),
      tentativas: z
        .array(
          z.object({
            aposHoras: z.number().positive(),
            instrucao: z.string().min(1),
          }),
        )
        .default([]),
    })
    .default({}),

  handoff: z
    .object({
      pausaAposHumanoMin: z.number().int().min(0).default(120),
      mensagem: z.string().default("Vou chamar alguem da equipe pra te ajudar. Um instante!"),
      gatilhos: z.array(z.string()).default([]),
      /**
       * WhatsApp pessoal de quem atende quando a IA passa a conversa. Sem ele, "chamar
       * a equipe" so marca a conversa no CRM, e ninguem fica sabendo se o CRM estiver
       * fechado. Mensagem que chega deste numero nunca vira lead.
       */
      avisarNoWhatsapp: z.string().default(""),
    })
    .default({}),

  camposExtras: z
    .array(
      z.object({
        chave: z.string().regex(/^[a-z0-9_]+$/),
        rotulo: z.string().min(1),
        tipo: z.enum(["texto", "numero", "data", "sim_nao"]).default("texto"),
      }),
    )
    .default([]),

  /**
   * Vocabulario FECHADO de etiquetas.
   *
   * A IA so pode escolher desta lista — ela vira um enum na ferramenta, entao
   * nao ha como inventar. Sem isso, o mesmo conceito vira "convenio",
   * "convênio", "tem convenio" e "plano de saude", e etiqueta que nao se
   * repete nao serve para filtrar nem contar.
   *
   * Lista vazia desliga as etiquetas da IA por completo.
   */
  etiquetas: z
    .array(
      z.object({
        nome: z.string().min(1),
        /** Quando aplicar. Vai no prompt; sem isso a IA chuta o criterio. */
        quando: z.string().default(""),
      }),
    )
    .default([]),

  /**
   * Respostas rapidas para a caixa de entrada ("/preco" vira o texto). Carregadas
   * no banco UMA vez, no primeiro inicio; depois a tela manda. {nome} vira o
   * primeiro nome do contato.
   */
  respostasRapidas: z
    .array(
      z.object({
        atalho: z.string().min(1),
        texto: z.string().min(1),
      }),
    )
    .default([]),

  conformidade: z
    .object({
      avisarQueEhIA: z.boolean().default(true),
    })
    .default({}),
});

export type Negocio = z.infer<typeof NegocioSchema>;

export interface ConfigNegocio {
  negocio: Negocio;
  /** Conteudo cru de conhecimento.md - vai inteiro no prompt, com cache. */
  conhecimento: string;
}

let cache: ConfigNegocio | null = null;

class ErroDeConfiguracao extends Error {}

export async function carregarNegocio(): Promise<ConfigNegocio> {
  const dir = path.resolve(env.NEGOCIO_DIR);
  const arquivoJson = path.join(dir, "negocio.json");
  const arquivoConhecimento = path.join(dir, "conhecimento.md");

  let bruto: string;
  try {
    bruto = await readFile(arquivoJson, "utf8");
  } catch {
    throw new ErroDeConfiguracao(
      `Nao encontrei o arquivo ${arquivoJson}.\n` +
        "Ele descreve o seu negocio e e obrigatorio.\n" +
        'Para comecar de um modelo pronto, copie o exemplo:\n' +
        "  Windows: copy negocio\\negocio.exemplo.json negocio\\negocio.json\n" +
        "  Mac:     cp negocio/negocio.exemplo.json negocio/negocio.json",
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch (e) {
    throw new ErroDeConfiguracao(
      `O arquivo negocio.json tem um erro de digitacao e nao pode ser lido.\n` +
        `Detalhe tecnico: ${(e as Error).message}\n` +
        "Normalmente e uma virgula sobrando no fim de uma lista, ou uma aspa que ficou aberta.",
    );
  }

  const resultado = NegocioSchema.safeParse(json);
  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((i) => `  - ${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("\n");
    throw new ErroDeConfiguracao(`O arquivo negocio.json tem campos invalidos:\n${problemas}`);
  }

  let conhecimento = "";
  try {
    conhecimento = await readFile(arquivoConhecimento, "utf8");
  } catch {
    // Conhecimento vazio funciona; a IA so vai saber o que esta no negocio.json.
    conhecimento = "";
  }

  cache = { negocio: resultado.data, conhecimento };
  return cache;
}

/** Config ja carregada. Chame carregarNegocio() uma vez no boot antes de usar. */
export function getNegocio(): ConfigNegocio {
  if (!cache) throw new Error("carregarNegocio() precisa ser chamado antes de getNegocio()");
  return cache;
}

export { ErroDeConfiguracao };
