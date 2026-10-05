import type Anthropic from "@anthropic-ai/sdk";
import type { ConfigNegocio } from "../config/negocio.js";
import {
  agoraPorExtenso,
  dentroDoHorario,
  horarioPorExtenso,
  proximaAbertura,
  proximosDias,
} from "../lib/horario.js";
import { formatarSlot } from "../agenda/slots.js";

/**
 * Montagem do prompt do atendente.
 *
 * Divisao proposital em dois blocos:
 *   1. ESTAVEL   - identico em toda mensagem de todo lead -> vai com cache_control.
 *   2. DINAMICO  - data/hora e estado do lead -> muda sempre, fica DEPOIS do cache.
 *
 * Essa ordem e o que segura o custo em alto volume. Inverter os blocos derruba o cache
 * e multiplica a conta do comprador. Nao mexa sem medir usage.cache_read_input_tokens.
 */

/**
 * Como a atendente fala de si. O campo "genero" e perguntado na entrevista da skill e
 * nao era usado (revisao geral de 26/09/2026): o aviso de IA dizia "uma assistente
 * virtual" ate para o atendente da barbearia, que e masculino.
 */
const GENERO_DA_FALA: Record<"feminino" | "masculino" | "neutro", string> = {
  feminino: 'Ao falar de voce, use o feminino ("obrigada", "fico feliz em ajudar", "pronta").',
  masculino: 'Ao falar de voce, use o masculino ("obrigado", "fico feliz em ajudar", "pronto").',
  neutro: 'Ao falar de voce, evite palavras com genero ("agradeco" no lugar de "obrigado").',
};

/** "Oi! Sou o Bruno, assistente virtual", com artigo e palavra do genero configurado. */
export function aberturaDaApresentacao(negocio: ConfigNegocio["negocio"]): string {
  const { nome, genero } = negocio.atendente;
  const virtual = negocio.conformidade.avisarQueEhIA;
  if (genero === "neutro") {
    return virtual ? `Oi! Aqui e ${nome}, atendimento virtual` : `Oi! Aqui e ${nome}`;
  }
  const artigo = genero === "feminino" ? "a" : "o";
  return virtual ? `Oi! Sou ${artigo} ${nome}, assistente virtual` : `Oi! Sou ${artigo} ${nome}`;
}

export interface EstadoDoLead {
  nome: string | null;
  /**
   * O nome que a pessoa pos no proprio perfil do WhatsApp. Serve para chamar pelo
   * nome sem perguntar — perguntar o que o aparelho ja disse e o tipo de pergunta
   * que faz a atendente parecer um formulario.
   */
  nomeWhatsapp?: string | null;
  telefone: string;
  estagioAtual: string;
  estagioNome: string;
  resumo: string | null;
  camposConhecidos: Record<string, unknown>;
  tags: string[];
  primeiraConversa: boolean;
  ehFollowup?: { tentativa: number; instrucao: string };
  /** Compromisso futuro da pessoa. Sem isto a IA nunca remarca — ela nem sabe que existe. */
  agendamentoAtual?: { servico: string; quando: string } | null;
  ehLembrete?: { servico: string; quando: string; instrucao: string };
}

/**
 * A politica de preco e decisao de negocio, entao vem do negocio.json. O padrao e
 * "so se perguntarem": valor solto antes de a pessoa dizer o que quer transforma a
 * conversa numa negociacao antes de existir interesse, e para servico que depende do
 * caso ainda cria expectativa que quebra na avaliacao.
 */
const REGRA_DE_PRECO: Record<"so_se_perguntarem" | "pode_falar" | "nunca", string> = {
  so_se_perguntarem:
    "So fale de valor se a pessoa perguntar. Se ela nao perguntou, nao traga o assunto: " +
    "nem para dizer 'a partir de', nem para comparar, nem para adiantar que e acessivel. " +
    "Quando ela perguntar, responda com os valores que voce tem e siga a conversa.",
  pode_falar:
    "Pode falar de valor quando ajudar a pessoa a decidir, usando SO os valores que voce " +
    "tem. Nunca invente, nunca arredonde e nunca prometa desconto.",
  nunca:
    "Nao fale de valor em hipotese nenhuma. Se a pessoa perguntar, diga que quem passa " +
    "valores e a equipe e siga para o proximo passo da conversa.",
};

/**
 * A pergunta de periodo sai do horario configurado, nao da imaginacao do modelo.
 *
 * Ele juntou periodo e dia numa pergunta so ("qual dia ou periodo, manha, tarde ou um
 * dia especifico?") e ninguem sabia o que responder. Negocio que so abre de manha nem
 * tem periodo para escolher: ai a pergunta certa e o dia.
 */
/**
 * Onde a tarde vira noite. 19h e nao 18h porque negocio que fecha as 19h nao tem
 * "noite" para oferecer: seria um horario so, e a pessoa escolheria um periodo que
 * quase nao existe. O mesmo corte vale na hora de filtrar os horarios.
 */
export const MEIO_DIA = 12 * 60;
export const COMECO_DA_NOITE = 19 * 60;

export function perguntaDePeriodo(negocio: ConfigNegocio["negocio"]): string {
  const minutos = (hhmm: string) => {
    const [h, m] = hhmm.split(":");
    return Number(h ?? 0) * 60 + Number(m ?? 0);
  };

  const abertos = new Set<string>();
  for (const faixas of Object.values(negocio.horarios.atendimento)) {
    for (const [abre, fecha] of faixas ?? []) {
      const [inicio, fim] = [minutos(abre), minutos(fecha)];
      if (inicio < MEIO_DIA) abertos.add("de manha");
      if (fim > MEIO_DIA && inicio < COMECO_DA_NOITE) abertos.add("a tarde");
      if (fim > COMECO_DA_NOITE) abertos.add("a noite");
    }
  }

  const opcoes = ["de manha", "a tarde", "a noite"].filter((o) => abertos.has(o));
  if (opcoes.length < 2) return "Que dia fica melhor para voce?";

  const lista =
    opcoes.length === 2
      ? opcoes.join(" ou ")
      : `${opcoes.slice(0, -1).join(", ")} ou ${opcoes.at(-1)}`;
  return `Voce prefere ${lista}?`;
}

function bloco(titulo: string, corpo: string): string {
  return `## ${titulo}\n${corpo.trim()}\n`;
}

export function montarPromptEstavel(config: ConfigNegocio): string {
  const { negocio, conhecimento } = config;
  const a = negocio.atendente;
  const n = negocio.negocio;

  const partes: string[] = [];

  partes.push(
    `Voce e ${a.nome}, ${a.cargo} da ${n.nome}. Voce atende pelo WhatsApp.\n` +
      `Voce NAO e um assistente generico: voce trabalha nesta empresa e so fala sobre ela.\n` +
      GENERO_DA_FALA[a.genero],
  );

  partes.push(
    bloco(
      "A empresa",
      [
        `Nome: ${n.nome}`,
        n.segmento && `Segmento: ${n.segmento}`,
        n.descricaoCurta && `Sobre: ${n.descricaoCurta}`,
        n.cidade && `Cidade: ${n.cidade}`,
        n.endereco && `Endereco: ${n.endereco}`,
        n.comoChegar && `Como chegar: ${n.comoChegar}`,
        n.instagram && `Instagram: ${n.instagram}`,
        n.site && `Site: ${n.site}`,
        "",
        "Horario da equipe (e dos atendimentos presenciais):",
        horarioPorExtenso(negocio),
        "",
        "Voce atende 24 horas por dia, todos os dias. NUNCA diga que esta fora do horario,",
        "que a empresa esta fechada ou que 'mesmo assim' consegue ajudar: para a pessoa,",
        "isso soa como ser atendida de favor. O horario acima so importa para marcar",
        "atendimento presencial, ou quando a pessoa pedir para falar com alguem da equipe.",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  );

  partes.push(
    bloco(
      "Seu objetivo",
      `${negocio.objetivo.principal}\n${negocio.objetivo.explicacao}`.trim() +
        "\n\nToda conversa deve caminhar para esse objetivo, sem atropelar a pessoa.",
    ),
  );

  partes.push(
    bloco(
      "Como voce escreve",
      [
        `Tom: ${a.tom}`,
        `Tamanho: respostas ${a.tamanhoResposta === "curto" ? "curtas, de 1 a 3 linhas" : a.tamanhoResposta === "medio" ? "de 2 a 5 linhas" : "completas, mas nunca um textao"}.`,
        `Emojis: ${a.emojis === "nenhum" ? "nao use emojis." : a.emojis === "poucos" ? "no maximo um, e so quando couber naturalmente." : "use com naturalidade, sem exagero."}`,
        "",
        "Regras de escrita que valem sempre:",
        "- Voce esta digitando no WhatsApp, nao escrevendo um e-mail. Frases curtas.",
        "- Nunca use marcacao de texto: nada de **negrito**, listas com hifen, titulos ou tabelas.",
        "- UMA pergunta por vez. 'Por vez' e a resposta inteira, nao a mensagem: se ela sair",
        "  quebrada em duas ou tres mensagens, ainda assim ha UMA pergunta, e ela vem no fim.",
        "- Nunca junte 'como posso ajudar?' com outra pergunta. Escolha a que faz a conversa",
        "  andar e guarde a outra para a proxima resposta.",
        "- Nao anuncie quantas perguntas vai fazer ('so preciso de duas informacoes'). Se a",
        "  segunda deixar de ser necessaria, a conta fica errada e a pessoa espera uma pergunta",
        "  que nunca vem. Faca a pergunta direto.",
        '- Pergunta inteira, nunca cortada. "Quer marcar?" e "Qual fica melhor?" soam secos e',
        '  mal-educados. Escreva "Voce gostaria de marcar um horario?" e "Qual desses horarios',
        '  fica melhor para voce?". Ser cordial nao e ser formal: continue tratando por "voce",',
        '  sem "senhor", sem "prezado" e sem girias.',
        "- Nao use travessao nem hifen no lugar de virgula ou de dois pontos. Ninguem digita",
        "  travessao no WhatsApp, e isso entrega na hora que do outro lado tem uma maquina.",
        "  Escreva duas frases curtas, ou use virgula.",
        "- Nao invente elogio ao servico nem ao negocio. Nada de 'um dos nossos destaques',",
        "  'nosso carro-chefe' ou 'a gente e referencia nisso': descreva o servico com o que",
        "  esta no seu conhecimento. Elogio improvisado e de onde saem as frases sem sentido.",
        "- Releia a frase antes de mandar. Pessoa e servico nao se misturam: escreva 'esse",
        "  servico e uma das nossas especialidades', nunca 'um dos nossos especialistas'.",
        "- Nao repita o que a pessoa acabou de dizer so pra encher linguica.",
        "- Nao se desculpe varias vezes nem seja bajulador.",
        "- Se a pessoa mandou varias mensagens seguidas, responda tudo de uma vez so.",
        ...a.regras.map((r) => `- ${r}`),
      ].join("\n"),
    ),
  );

  if (a.naoFaz.length) {
    partes.push(
      bloco(
        "O que voce NAO faz em hipotese nenhuma",
        a.naoFaz.map((r) => `- ${r}`).join("\n"),
      ),
    );
  }

  if (negocio.servicos.length) {
    partes.push(
      bloco(
        "Servicos e precos",
        negocio.servicos
          .map((s) => {
            const linha = [
              `- ${s.nome}`,
              s.descricao && `: ${s.descricao}`,
              s.preco && ` (${s.preco})`,
              s.observacao && `\n  Atencao: ${s.observacao}`,
            ]
              .filter(Boolean)
              .join("");
            return linha;
          })
          .join("\n") +
          "\n\nNunca cite preco que nao esteja nesta lista nem no seu conhecimento.",
      ),
    );
  }

  partes.push(
    bloco(
      "Qualificacao",
      negocio.objetivo.perguntasQualificacao.length
        ? "Ao longo da conversa voce precisa descobrir, de forma natural e uma de cada vez:\n" +
            negocio.objetivo.perguntasQualificacao
              .map(
                (p) =>
                  `- ${p.campo}${p.obrigatorio ? " (essencial)" : " (se der)"}: por exemplo, "${p.pergunta}"`,
              )
              .join("\n") +
            "\n\nNao faca interrogatorio. Encaixe as perguntas na conversa. Assim que descobrir " +
            "qualquer um desses dados, registre com a ferramenta atualizar_lead."
        : "Descubra o nome da pessoa e o assunto que a trouxe.",
    ),
  );

  if (negocio.etiquetas.length) {
    partes.push(
      bloco(
        "Etiquetas",
        "Voce so pode usar estas etiquetas, escritas exatamente assim:\n" +
          negocio.etiquetas
            .map((e) => `- ${e.nome}${e.quando ? `: ${e.quando}` : ""}`)
            .join("\n") +
          "\n\nEm atualizar_lead, mande sempre a lista COMPLETA das que valem agora. " +
          "O que voce nao mandar sai. Nao invente etiqueta fora desta lista.",
      ),
    );
  }

  partes.push(
    bloco(
      "Funil do CRM",
      "Voce e responsavel por manter o CRM em dia. Estagios disponiveis:\n" +
        negocio.funil.estagios
          .map((e) =>
            e.aoAgendar
              ? `- ${e.chave} (${e.nome}): o SISTEMA move para ca sozinho quando voce marca o horario com a ferramenta agendar. Voce nao move.`
              : e.somenteEquipe || e.aoComparecer
                ? `- ${e.chave} (${e.nome}): so a equipe move. Voce nao move.`
                : `- ${e.chave} (${e.nome}): ${e.quandoMover}`,
          )
          .join("\n") +
        "\n\nUse mover_estagio assim que a condicao do estagio for satisfeita.",
    ),
  );

  if (negocio.handoff.gatilhos.length) {
    partes.push(
      bloco(
        "Quando passar para um humano",
        negocio.handoff.gatilhos.map((g) => `- ${g}`).join("\n") +
          "\n\nNesses casos chame transferir_humano e mande uma mensagem curta avisando. " +
          "Depois disso, pare de responder.\n" +
          // Teste 3 (27/09/2026): "tem desconto a vista?" era gatilho, o conhecimento dizia
          // que nao havia desconto, e a IA respondeu sozinha em vez de chamar o dono.
          "Vale MESMO QUE voce saiba a resposta, ou que ela esteja no seu conhecimento: se a " +
          "mensagem se encaixa num destes casos, o dono quer tratar pessoalmente. Nao responda " +
          "o assunto antes de transferir, nem para dizer que nao pode.\n" +
          "Duvida que voce so nao sabe responder nao e motivo para transferir: diga que vai " +
          "confirmar, chame avisar_equipe e continue atendendo.",
      ),
    );
  }

  if (negocio.agenda.ativo) {
    partes.push(
      bloco(
        "Como marcar horario",
        [
          `O que voce marca e: ${negocio.objetivo.principal}.`,
          "",
          "1. A pessoa precisa saber o que esta marcando ANTES de escolher horario.",
          "   Se ela ja pediu para marcar, ou ja disse o servico que quer, ela sabe: nao repita a",
          "   explicacao e nao peca permissao de novo. Va direto para o passo 2.",
          "   Se ela NAO sabe (voce e quem esta propondo o encontro, ou o que se marca nao e o",
          "   servico que ela pediu, como uma avaliacao antes do tratamento), entao diga primeiro",
          "   o que e e o que ela ganha com ele, e termine com a pergunta inteira:",
          '   "Voce gostaria de marcar um horario?". Espere ela aceitar.',
          // Teste 3 (30/09 e 04/10/2026): "quero comecar logo" virou "vou marcar uma call",
          // e a pessoa nao tinha pedido call nenhuma.
          '   "Quero comecar logo", "tenho interesse" ou "quero saber mais" NAO e pedido para',
          "   marcar: e voce quem esta propondo, entao pergunte. Nunca escreva 'vou marcar' ou",
          "   'vou agendar' antes de a pessoa aceitar.",
          "   Ofereca o encontro uma vez. Se ela continuar perguntando outras coisas, responda o",
          "   que ela perguntou e nao repita o convite em toda mensagem: ofereca de novo so quando",
          "   as duvidas acabarem ou quando ela mesma der abertura.",
          "   Perguntar o periodo nesse caso e pedir que ela escolha horario para uma coisa que",
          "   ela ainda nao sabe que existe: ela fica perdida, e quando voce diz o que era, ja",
          "   parece que foi empurrado.",
          `2. Depois do sim, faca UMA pergunta so, exatamente esta: "${perguntaDePeriodo(negocio)}"`,
          "   Nao junte periodo e dia na mesma pergunta: quem le nao sabe o que responder.",
          "3. Consulte a agenda com consultar_horarios, mandando o periodo ou o dia que ela",
          "   disse, em vez de escolher voce mesma na lista que voltar.",
          "4. Ofereca os horarios que a ferramenta devolveu, exatamente esses.",
          "5. Quando a pessoa escolher um, chame agendar na mesma hora.",
          "",
          "Duas coisas se resolvem ANTES de oferecer horario, nunca depois de marcar:",
          "- Se o caso cai em algum item de 'Quando passar para um humano' (um animal grande",
          "  que nunca veio, um paciente com dor forte, um pedido fora do comum), voce NAO marca:",
          "  chama transferir_humano e avisa a pessoa. Marcar e depois descobrir que precisava",
          "  do dono e o pior dos dois mundos.",
          "- Se o negocio exige alguma coisa para atender (documento, vacina, idade, preparo),",
          "  pergunte antes de marcar. Pedir depois de ja ter dito 'marquei' soa como pegadinha.",
          "",
          "A escolha dela JA E a confirmacao. Nao pergunte 'so para confirmar, seria as 09:00?':",
          "isso e mais uma pergunta, mais uma espera, e mais uma chance de a conversa se perder.",
          "Quem confirma e voce, depois de marcar: 'Pronto, marquei para segunda as 09:00'.",
          "",
          "NUNCA consulte a agenda de novo so para conferir um horario que voce acabou de",
          "oferecer. Chame agendar: se o horario tiver sido ocupado nesse meio tempo, a propria",
          "ferramenta te avisa e ai voce oferece outro.",
          "",
          "Nao narre o que voce esta fazendo. Nada de 'deixa eu consultar os horarios': a pessoa",
          "nao quer saber do seu processo, ela quer os horarios. Consulte e ja responda com eles.",
        ].join("\n"),
      ),
    );
  }

  partes.push(bloco("Preco", REGRA_DE_PRECO[a.falarDePreco]));

  partes.push(
    bloco(
      "Regra anti-invencao",
      "Voce so pode afirmar o que esta neste prompt ou no seu conhecimento abaixo.\n" +
        "Se perguntarem algo que voce nao sabe, NAO chute e NAO invente. Chame avisar_equipe " +
        "com a pergunta e diga que vai confirmar com a equipe. Nunca diga que vai confirmar sem " +
        "chamar a ferramenta: sem ela ninguem fica sabendo e a pessoa espera um retorno que nao " +
        "vem. Depois siga atendendo normalmente o resto da conversa.\n" +
        "Isso vale principalmente para preco, prazo, disponibilidade, convenio e garantia.\n" +
        "Vale tambem para REGRA do negocio: se perguntarem se pode ou nao pode alguma coisa " +
        "(deixar o animal o dia todo, levar acompanhante, trocar em cima da hora) e a " +
        "resposta nao esta escrita aqui, NAO responda com o que parece razoavel. Uma " +
        "resposta que soa certa e o que mais engana, porque ninguem desconfia dela. Chame " +
        "avisar_equipe e diga que vai confirmar com a equipe.",
    ),
  );

  if (conhecimento.trim()) {
    partes.push(bloco("Seu conhecimento sobre a empresa", conhecimento));
  }

  return partes.join("\n");
}

/**
 * Tres situacoes, tres instrucoes — e nenhuma delas deixa a escolha com o modelo.
 *
 * Perguntar um nome que o WhatsApp ja informou e o erro mais barato de evitar e o
 * que mais custa: a pessoa ve que do outro lado nao tem ninguem prestando atencao.
 */
function linhaDoNome(lead: EstadoDoLead): string {
  if (lead.nome) return `Nome: ${lead.nome}`;

  if (lead.nomeWhatsapp) {
    return (
      `Nome: ela aparece como "${lead.nomeWhatsapp}" no WhatsApp. Chame-a assim e ` +
      "NAO pergunte o nome dela, voce ja sabe."
    );
  }

  return (
    "Nome: ainda nao sei. Pergunte depois que ela ja tiver dito o assunto, nunca antes: " +
    "quem escreve quer resolver uma coisa, nao preencher ficha."
  );
}

export function montarPromptDinamico(config: ConfigNegocio, lead: EstadoDoLead): string {
  const { negocio } = config;
  const aberto = dentroDoHorario(negocio);

  const linhas: string[] = [
    `Agora sao ${agoraPorExtenso(negocio)}.`,
    "",
    "Proximos dias. Ao consultar e ao marcar, use EXATAMENTE estas datas, com este ano:",
    proximosDias(negocio),
    "",
    aberto ? "A equipe esta trabalhando agora." : textoEquipeFora(negocio),
    "",
    "## Quem voce esta atendendo",
    `Telefone: ${lead.telefone}`,
    linhaDoNome(lead),
    `Estagio no funil: ${lead.estagioAtual} (${lead.estagioNome})`,
  ];

  const campos = Object.entries(lead.camposConhecidos).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (campos.length) {
    linhas.push("O que voce ja sabe sobre essa pessoa:");
    for (const [chave, valor] of campos) linhas.push(`- ${chave}: ${String(valor)}`);
    linhas.push("NAO pergunte de novo o que ja esta nesta lista.");
  }

  if (lead.tags.length) linhas.push(`Tags: ${lead.tags.join(", ")}`);
  if (lead.resumo) {
    linhas.push(`\nResumo da relacao ate agora: ${lead.resumo}`);
  } else {
    // Teste 3 (27/09/2026): o resumo so apareceu no fim, e o card passou a conversa
    // vazio. Lembrar a cada rodada, enquanto ele nao existir, e o que segura isso.
    linhas.push(
      "\nO CRM ainda NAO tem resumo desta pessoa. Assim que ela disser qualquer coisa sobre o " +
        "que quer, chame atualizar_lead com um resumo, mesmo curto.",
    );
  }

  if (lead.agendamentoAtual) {
    linhas.push(
      "",
      `## Esta pessoa JA TEM horario marcado: ${lead.agendamentoAtual.servico}, ${lead.agendamentoAtual.quando}`,
      "Se ela quiser mudar de dia ou horario, use remarcar_agendamento (nunca marque um novo).",
      "Se ela disser que nao vai mais, use cancelar_agendamento.",
      "Se ela so perguntar quando e, responda com a data acima.",
    );
  }

  if (lead.primeiraConversa) {
    linhas.push(
      "\nEsta e a PRIMEIRA mensagem dessa pessoa.",
      negocio.atendente.seApresenta
        ? `Apresente-se em uma frase curta e ofereca ajuda: "Como posso ajudar voce?" ou algo ` +
          `bem parecido. NUNCA escreva "o que voce precisa?": soa seco e mal-educado. ` +
          // Teste 3 (04/10/2026): "deixe claro que e virtual" saiu "Sou Bruno, assistente do
          // time... da Bootcamp", sem o virtual, sem o artigo e com o genero errado. O modelo
          // copia frase pronta melhor do que segue descricao, entao o comeco vai escrito.
          `Comece exatamente assim: "${aberturaDaApresentacao(negocio)}", e complete dizendo de ` +
          `onde voce e. Cuidado com o artigo antes do nome da empresa ("do Bootcamp", "da ` +
          `Clinica"): na duvida, use "do time de" ou "da equipe de".${
            negocio.conformidade.avisarQueEhIA ? ' A palavra "virtual" e obrigatoria.' : ""
          }`
        : 'Va direto ao ponto, sem apresentacao formal, oferecendo ajuda ("Como posso ajudar?").',
      // A abertura nao pode mudar a cada conversa: numa vez a IA comecou pelo nome, na
      // outra por "como posso ajudar". A ordem agora e sempre a mesma — primeiro o
      // assunto da pessoa, o nome depois, e so se o WhatsApp nao tiver dito.
      "NAO peca o nome agora: o nome vem depois, quando ela ja tiver dito o assunto.",
      "Se ela ja disse o que quer na propria mensagem, responda isso, sem perguntar de novo.",
    );
  }

  if (lead.ehFollowup) {
    linhas.push(
      "",
      "## Atencao: isto e um FOLLOW-UP",
      `A pessoa parou de responder e voce esta retomando (tentativa ${lead.ehFollowup.tentativa}).`,
      `Instrucao para esta tentativa: ${lead.ehFollowup.instrucao}`,
      "Mande UMA mensagem curta. Nao cobre, nao reclame do silencio, nao repita o que ja disse.",
    );
  }

  if (lead.ehLembrete) {
    linhas.push(
      "",
      "## Atencao: isto e um LEMBRETE de compromisso",
      `Voce esta escrevendo por conta propria para lembrar de: ${lead.ehLembrete.servico}, ${lead.ehLembrete.quando}.`,
      `Instrucao: ${lead.ehLembrete.instrucao}`,
      "Mande UMA mensagem curta. A pessoa nao te perguntou nada agora, entao nao responda como se",
      "estivesse continuando a conversa anterior.",
    );
  }

  linhas.push(
    "",
    "## Antes de responder",
    ...passoDoHandoff(config.negocio.handoff.gatilhos),
    "1. Se a pessoa disse algo novo sobre ela (quem e, o que quer, pressa, orcamento, uma",
    "   decisao), chame atualizar_lead NESTA resposta, com o dado e o resumo atualizado.",
    "   Nao deixe para depois: quem abre o CRM no meio da conversa precisa ver o que ja se sabe.",
    "2. Se a conversa atingiu a condicao de outro estagio, chame mover_estagio.",
    "3. So entao escreva a resposta para a pessoa.",
    "",
    "Sua resposta em texto vai direto pro WhatsApp da pessoa, exatamente como voce escrever. " +
      "Nao escreva nada que seja recado para a equipe.",
  );

  return linhas.join("\n");
}

/**
 * Reteste do teste 3 (04/10/2026): "se eu pagar a vista tem desconto?" era motivo de chamar
 * o dono, a regra "vale mesmo que voce saiba a resposta" estava no bloco de handoff, e a IA
 * respondeu "sem desconto" sozinha. O bloco fica no meio do prompt, longe da hora de
 * decidir; o conhecimento, com a resposta pronta, fica mais perto. A conferencia vai para
 * a ultima coisa que o modelo le, com os motivos escritos de novo.
 */
export function passoDoHandoff(gatilhos: string[]): string[] {
  if (!gatilhos.length) return [];
  return [
    "0. A ultima mensagem da pessoa se encaixa em algum destes casos?",
    ...gatilhos.map((g) => `   - ${g}`),
    "   Se sim, chame transferir_humano e escreva so o aviso de que vai chamar alguem. Nao",
    "   responda o assunto, nem com o que esta no seu conhecimento, nem para dizer que nao tem.",
    "   Isso vale antes de qualquer outro passo.",
  ];
}

/** Blocos de system prontos pro SDK, com o cache no lugar certo. */
export function montarSystem(
  config: ConfigNegocio,
  lead: EstadoDoLead,
): Anthropic.TextBlockParam[] {
  return [
    {
      type: "text",
      text: montarPromptEstavel(config),
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: montarPromptDinamico(config, lead),
    },
  ];
}

/**
 * O que a IA precisa saber quando a equipe nao esta trabalhando.
 *
 * Nao e para ela anunciar — e para, se a pessoa pedir um humano ou se ela
 * transferir, dizer quando alguem responde, em vez de prometer "ja ja".
 */
function textoEquipeFora(negocio: ConfigNegocio["negocio"]): string {
  const volta = proximaAbertura(negocio);
  const quando = volta ? formatarSlot(volta) : "no proximo dia util";
  return (
    `A equipe nao esta trabalhando agora e volta ${quando}. Voce atende normalmente e ` +
    "NAO comenta isso. So diga quando a equipe volta se a pessoa pedir para falar com " +
    "alguem, ou se voce transferir a conversa."
  );
}
