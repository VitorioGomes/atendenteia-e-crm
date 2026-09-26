import { ErroApi } from "./api";
import type {
  Agendamento,
  Bloqueio,
  Cartao,
  ContatoResumo,
  ConversaResumo,
  Estagio,
  Evento,
  HorarioLivre,
  Lead,
  ListaContatos,
  ListaConversas,
  Mensagem,
  OpcoesArquivo,
  AbaAgenda,
  HorariosSemana,
  ListaAgenda,
  PeriodoAgenda,
  RespostaRapida,
  Painel as PainelDados,
  ResultadoImportacao,
  Resumo,
  StatusWhatsapp,
} from "./api";

/**
 * MODO DEMONSTRACAO.
 *
 * Serve para duas coisas:
 *   1. ver e ajustar o CRM sem precisar de VPS, banco e WhatsApp conectado;
 *   2. gravar a demo de vendas com uma tela cheia e crivel, em vez de um CRM vazio.
 *
 * Nada aqui roda em producao: e ativado so por VITE_DEMO=1 (npm run demo).
 * Os dados sao ficticios.
 */

const minutos = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const horas = (n: number) => minutos(n * 60);
const dias = (n: number) => horas(n * 24);
const daquiAHoras = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

// Agendamentos futuros caem em dia e hora em que a clinica abre (nada de domingo,
// nada de 05:34), e os textos da conversa saem da mesma data. Antes era "daqui a
// 18h" e a janela do lead dizia "amanhã às 10:00" na conversa e "domingo às 05:34"
// no agendamento. Todos de manha, que cabe ate no sabado (09:00 as 13:00).
const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
function diaAberto(n: number, hora: number, minuto = 0): Date {
  const d = new Date();
  d.setHours(hora, minuto, 0, 0);
  let abertos = 0;
  while (abertos < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0) abertos++;
  }
  return d;
}
/** O n-esimo dia aberto ANTES de hoje, na hora dada: o passado da agenda. */
function diaAbertoAntes(n: number, hora: number, minuto = 0): Date {
  const d = new Date();
  d.setHours(hora, minuto, 0, 0);
  let abertos = 0;
  while (abertos < n) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0) abertos++;
  }
  return d;
}
/** "amanhã" ou o dia da semana ("segunda"). */
function rotuloDoDia(d: Date): string {
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  return d.toDateString() === amanha.toDateString() ? "amanhã" : SEMANA[d.getDay()]!;
}
/** "segunda-feira, 28/09 às 10:00", como o historico do sistema escreve. */
function diaCompleto(d: Date): string {
  const nome = d.getDay() === 0 || d.getDay() === 6 ? SEMANA[d.getDay()] : `${SEMANA[d.getDay()]}-feira`;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${nome}, ${dd}/${mm} às ${hh}:${mi}`;
}

const AVALIACAO_CARLOS = diaAberto(1, 10);
const OUTRA_OPCAO_CARLOS = diaAberto(2, 11, 20);
const AVALIACAO_ROBERTO = diaAberto(2, 11);
const OUTRA_OPCAO_ROBERTO = diaAberto(3, 9, 40);
const DIA_CARLOS = rotuloDoDia(AVALIACAO_CARLOS);
const DIA_ROBERTO = rotuloDoDia(AVALIACAO_ROBERTO);

const ESTAGIOS = [
  { id: "e1", chave: "novo_lead", nome: "Novo lead", ganho: false, perdido: false },
  { id: "e2", chave: "qualificando", nome: "Qualificando", ganho: false, perdido: false },
  { id: "e3", chave: "qualificado", nome: "Qualificado", ganho: false, perdido: false },
  { id: "e4", chave: "agendado", nome: "Avaliação agendada", ganho: false, perdido: false, agendado: true },
  { id: "e5", chave: "compareceu", nome: "Compareceu", ganho: true, perdido: false },
  { id: "e6", chave: "perdido", nome: "Perdido", ganho: false, perdido: true },
];

/**
 * A regra de src/crm/atencao.ts, simplificada: alguém esperando E (conversa com a
 * equipe OU a IA já deveria ter respondido). Precisa bater nas três telas.
 */
function precisaDeVoceDemo(c: CartaoDemo): boolean {
  const ultima = c.mensagens[c.mensagens.length - 1];
  const esperando = ultima?.direction === "IN";
  // Desde 26/09/2026 o laranja e so "esta com voce e alguem espera": a regra dos
  // 3 minutos sem resposta da IA saiu (decisao do dono).
  return c.modo === "HUMAN" && esperando;
}

const PREVIA: Record<string, string> = {
  AUDIO: "Áudio",
  IMAGE: "Foto",
  VIDEO: "Vídeo",
  DOCUMENT: "Documento",
};

interface CartaoDemo extends Cartao {
  campos: Record<string, string>;
  mensagens: Mensagem[];
  eventos: Evento[];
}

function cartao(
  dados: Partial<CartaoDemo> & {
    id: string;
    estagioId: string;
    nome: string;
    telefone: string;
  },
): CartaoDemo {
  return {
    titulo: dados.nome,
    telefoneFormatado: dados.telefone.replace(/^55(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3"),
    resumo: null,
    proximoPasso: null,
    valor: null,
    tags: [],
    atualizadoEm: horas(1),
    ultimoContatoEm: horas(1),
    conversaId: "c-" + dados.id,
    modo: "BOT",
    pausado: false,
    aguardandoResposta: false,
    campos: {},
    mensagens: [],
    eventos: [],
    ...dados,
  } as CartaoDemo;
}

const CARTOES: CartaoDemo[] = [
  cartao({
    id: "d1",
    estagioId: "e2",
    nome: "Ana Paula Ribeiro",
    telefone: "5511987654321",
    resumo:
      "Quer lentes de contato dental nos dentes da frente. Já fez orçamento em outro lugar e achou caro. Particular, sem convênio.",
    proximoPasso: "Confirmar se prefere manhã ou sábado para a avaliação",
    tags: ["particular", "comparando preço"],
    atualizadoEm: minutos(4),
    ultimoContatoEm: minutos(4),
    aguardandoResposta: false,
    campos: {
      procedimento_interesse: "lentes de contato dental",
      urgencia: "sem dor, é estético",
      convenio: "particular",
    },
    mensagens: [
      { id: "m1", direction: "IN", author: "CONTACT", kind: "TEXT", text: "oi, boa tarde", transcript: null, createdAt: minutos(22) },
      { id: "m2", direction: "IN", author: "CONTACT", kind: "TEXT", text: "vcs fazem lente de contato nos dentes?", transcript: null, createdAt: minutos(22) },
      { id: "m3", direction: "OUT", author: "BOT", kind: "TEXT", text: "Oi! Eu sou a Marina, assistente virtual da Clínica Sorriso Vivo 😊 Fazemos sim! Como você se chama?", transcript: null, createdAt: minutos(21) },
      { id: "m4", direction: "IN", author: "CONTACT", kind: "TEXT", text: "Ana Paula", transcript: null, createdAt: minutos(19) },
      { id: "m5", direction: "OUT", author: "BOT", kind: "TEXT", text: "Prazer, Ana Paula! Você tem interesse nos dentes da frente ou pensou em algo mais amplo?", transcript: null, createdAt: minutos(18) },
      { id: "m6", direction: "IN", author: "CONTACT", kind: "AUDIO", text: "[audio]", transcript: "Oi Marina, é nos da frente mesmo, uns seis ou oito dentes. Eu já fiz orçamento numa clínica aqui perto e ficou quase vinte mil, achei bem caro. Queria saber quanto fica aí.", createdAt: minutos(12) },
      { id: "m7", direction: "OUT", author: "BOT", kind: "TEXT", text: "Entendi, Ana Paula. Nossas lentes ficam a partir de R$ 1.800 por dente, mas o valor fechado depende muito do seu caso: quantos dentes, o estado deles e o resultado que você quer.", transcript: null, createdAt: minutos(11) },
      { id: "m8", direction: "OUT", author: "BOT", kind: "TEXT", text: "Por isso a avaliação aqui é gratuita e você sai dela com o plano e o orçamento fechado no mesmo dia, sem compromisso. Prefere manhã, tarde ou sábado?", transcript: null, createdAt: minutos(11) },
      { id: "m9", direction: "IN", author: "CONTACT", kind: "TEXT", text: "sábado seria melhor pra mim", transcript: null, createdAt: minutos(4) },
    ],
    eventos: [
      { id: "v1", type: "summary", body: "Quer lentes nos dentes da frente. Comparando preço com outra clínica.\nPróximo passo: confirmar horário de sábado", author: "ia", createdAt: minutos(11) },
      { id: "v2", type: "stage_changed", body: "Novo lead -> Qualificando: informou nome e procedimento de interesse", author: "ia", createdAt: minutos(18) },
    ],
  }),
  cartao({
    id: "d2",
    estagioId: "e4",
    nome: "Carlos Mendes",
    telefone: "5511991234567",
    resumo:
      "Perdeu um dente inferior há 2 meses e quer implante. Já usou o convênio Amil para a extração. Avaliação marcada.",
    proximoPasso: `Avaliação ${DIA_CARLOS} às 10:00`,
    valor: 2500,
    tags: ["convênio"],
    atualizadoEm: horas(3),
    ultimoContatoEm: horas(3),
    campos: {
      procedimento_interesse: "implante dentário",
      convenio: "Amil Dental",
      urgencia: "sem dor",
    },
    mensagens: [
      { id: "m10", direction: "IN", author: "CONTACT", kind: "TEXT", text: "bom dia, vcs fazem implante?", transcript: null, createdAt: horas(5) },
      { id: "m11", direction: "OUT", author: "BOT", kind: "TEXT", text: "Bom dia! Sou a Marina, da Clínica Sorriso Vivo 😊 Fazemos sim. Como você se chama?", transcript: null, createdAt: horas(5) },
      { id: "m12", direction: "IN", author: "CONTACT", kind: "TEXT", text: "Carlos. perdi um dente de baixo faz uns 2 meses", transcript: null, createdAt: horas(5) },
      { id: "m13", direction: "OUT", author: "BOT", kind: "TEXT", text: "Entendi, Carlos. Você está sentindo alguma dor ou incômodo agora?", transcript: null, createdAt: horas(5) },
      { id: "m14", direction: "IN", author: "CONTACT", kind: "TEXT", text: "não, nenhuma dor. tenho amil, cobre?", transcript: null, createdAt: horas(4) },
      { id: "m15", direction: "OUT", author: "BOT", kind: "TEXT", text: "Atendemos Amil Dental sim! O implante em si costuma ser particular, mas a avaliação é gratuita e lá a gente confere direitinho o que o seu plano cobre no seu caso.", transcript: null, createdAt: horas(4) },
      { id: "m16", direction: "OUT", author: "BOT", kind: "TEXT", text: `Tenho ${DIA_CARLOS} às 10:00 ou ${rotuloDoDia(OUTRA_OPCAO_CARLOS)} às 11:20. Algum desses funciona?`, transcript: null, createdAt: horas(4) },
      { id: "m17", direction: "IN", author: "CONTACT", kind: "TEXT", text: `${DIA_CARLOS} 10h tá ótimo`, transcript: null, createdAt: horas(3) },
      { id: "m18", direction: "OUT", author: "BOT", kind: "TEXT", text: `Marcado, Carlos! Avaliação ${DIA_CARLOS} às 10:00, na Rua das Acácias, 120, sala 4, em Pinheiros. Fica a 5 min do metrô Fradique Coutinho e temos convênio com o estacionamento do prédio. Até lá! 😊`, transcript: null, createdAt: horas(3) },
    ],
    eventos: [
      { id: "v3", type: "appointment", body: `Agendado: Avaliação em ${diaCompleto(AVALIACAO_CARLOS)}`, author: "ia", createdAt: horas(3) },
      { id: "v4", type: "stage_changed", body: "Qualificado -> Avaliação agendada: horário confirmado pelo paciente", author: "ia", createdAt: horas(3) },
    ],
  }),
  cartao({
    id: "d3",
    estagioId: "e2",
    nome: "Juliana Alves",
    telefone: "5511988887777",
    resumo:
      "Está com dor de dente forte desde ontem à noite. Caso de urgência: a IA transferiu para atendimento humano.",
    proximoPasso: "ATENDER: paciente com dor forte, encaixar hoje",
    tags: ["urgência"],
    atualizadoEm: minutos(6),
    ultimoContatoEm: minutos(6),
    modo: "HUMAN",
    campos: { urgencia: "dor forte desde ontem" },
    mensagens: [
      { id: "m19", direction: "IN", author: "CONTACT", kind: "TEXT", text: "socorro, to com uma dor de dente horrivel desde ontem a noite", transcript: null, createdAt: minutos(41) },
      { id: "m20", direction: "OUT", author: "BOT", kind: "TEXT", text: "Poxa, sinto muito 😔 Dor de dente é horrível mesmo. Vou chamar alguém da equipe aqui pra te ajudar melhor com isso, tá? Só um instante.", transcript: null, createdAt: minutos(40) },
      { id: "m21", direction: "OUT", author: "HUMAN", kind: "TEXT", text: "Oi Juliana, aqui é a Renata da clínica. Consigo te encaixar hoje às 16h com a Dra. Camila. Consegue vir?", transcript: null, createdAt: minutos(35) },
      { id: "m21b", direction: "IN", author: "CONTACT", kind: "TEXT", text: "consigo sim! preciso levar algum exame?", transcript: null, createdAt: minutos(6) },
    ],
    eventos: [
      { id: "v5", type: "handoff", body: "Transferido para atendimento humano: paciente relatou dor forte, caso de urgência", author: "ia", createdAt: minutos(40) },
    ],
  }),
  cartao({
    id: "d4",
    estagioId: "e1",
    nome: "Marcos Vinícius",
    telefone: "5511993334444",
    resumo: "Perguntou sobre clareamento. Ainda não respondeu à primeira pergunta.",
    atualizadoEm: minutos(2),
    ultimoContatoEm: minutos(3),
    mensagens: [
      { id: "m22", direction: "IN", author: "CONTACT", kind: "TEXT", text: "quanto custa clareamento?", transcript: null, createdAt: minutos(3) },
      { id: "m23", direction: "OUT", author: "BOT", kind: "TEXT", text: "Oi! Sou a Marina, da Clínica Sorriso Vivo 😊 O clareamento em consultório sai a partir de R$ 900, normalmente em 2 a 3 sessões. Como você se chama?", transcript: null, createdAt: minutos(2) },
    ],
  }),
  cartao({
    id: "d5",
    estagioId: "e3",
    nome: "Fernanda Lima",
    telefone: "5511995556666",
    resumo:
      "Quer harmonização facial (toxina botulínica na testa). Primeira vez, está insegura. Particular. Perguntou sobre parcelamento.",
    proximoPasso: "Oferecer horários de terça e quinta à tarde",
    tags: ["particular"],
    atualizadoEm: horas(20),
    ultimoContatoEm: horas(20),
    campos: {
      procedimento_interesse: "harmonização facial",
      convenio: "particular",
      melhor_periodo: "tarde",
    },
    mensagens: [
      { id: "m24", direction: "IN", author: "CONTACT", kind: "TEXT", text: "oi, vcs fazem botox?", transcript: null, createdAt: horas(22) },
      { id: "m25", direction: "OUT", author: "BOT", kind: "TEXT", text: "Oi! Sou a Marina, da Clínica Sorriso Vivo 😊 Fazemos harmonização facial sim, incluindo toxina botulínica. Como você se chama?", transcript: null, createdAt: horas(22) },
      { id: "m26", direction: "IN", author: "CONTACT", kind: "TEXT", text: "Fernanda. nunca fiz, to meio insegura. dá pra parcelar?", transcript: null, createdAt: horas(21) },
      { id: "m27", direction: "OUT", author: "BOT", kind: "TEXT", text: "Super normal ficar insegura na primeira vez, Fernanda. Parcelamos em até 12x no cartão (acima de 6x tem juros da máquina), e no PIX tem 5% de desconto.", transcript: null, createdAt: horas(21) },
      { id: "m28", direction: "OUT", author: "BOT", kind: "TEXT", text: "A avaliação é gratuita e sem compromisso: a médica te explica tudo, mostra o que dá pra fazer no seu caso e você decide com calma depois. Qual período costuma ser melhor pra você?", transcript: null, createdAt: horas(21) },
      { id: "m29", direction: "IN", author: "CONTACT", kind: "TEXT", text: "tarde", transcript: null, createdAt: horas(20) },
    ],
    eventos: [
      { id: "v6", type: "summary", body: "Interesse em toxina botulínica, primeira vez, insegura. Sensível a preço, perguntou parcelamento.", author: "ia", createdAt: horas(21) },
    ],
  }),
  cartao({
    id: "d6",
    estagioId: "e4",
    nome: "Roberto Tanaka",
    telefone: "5511997778888",
    resumo: `Clareamento antes do casamento da filha em novembro. Avaliação marcada para ${DIA_ROBERTO}.`,
    proximoPasso: `Avaliação ${DIA_ROBERTO} às 11:00`,
    valor: 900,
    tags: ["particular"],
    atualizadoEm: dias(1),
    ultimoContatoEm: dias(1),
    campos: {
      procedimento_interesse: "clareamento",
      convenio: "particular",
      melhor_periodo: "manhã",
    },
    mensagens: [
      { id: "m30", direction: "IN", author: "CONTACT", kind: "TEXT", text: "Boa tarde. Minha filha casa em novembro e eu queria clarear os dentes antes. Dá tempo?", transcript: null, createdAt: dias(1) },
      { id: "m31", direction: "OUT", author: "BOT", kind: "TEXT", text: "Boa tarde! Sou a Marina, da Clínica Sorriso Vivo 😊 Dá tempo com folga: o clareamento leva de 2 a 3 sessões, cerca de 3 semanas no total. Como você se chama?", transcript: null, createdAt: dias(1) },
      { id: "m32", direction: "IN", author: "CONTACT", kind: "TEXT", text: "Roberto. Que bom! Pode marcar então", transcript: null, createdAt: dias(1) },
      { id: "m33", direction: "OUT", author: "BOT", kind: "TEXT", text: `Perfeito, Roberto! Tenho ${DIA_ROBERTO} às 11:00 ou ${rotuloDoDia(OUTRA_OPCAO_ROBERTO)} às 09:40. Qual fica melhor?`, transcript: null, createdAt: dias(1) },
      { id: "m34", direction: "IN", author: "CONTACT", kind: "TEXT", text: `${DIA_ROBERTO} 11h`, transcript: null, createdAt: dias(1) },
    ],
    eventos: [
      { id: "v7", type: "appointment", body: `Agendado: Avaliação em ${diaCompleto(AVALIACAO_ROBERTO)}`, author: "ia", createdAt: dias(1) },
    ],
  }),
  cartao({
    id: "d7",
    estagioId: "e5",
    nome: "Patrícia Nogueira",
    telefone: "5511994445555",
    resumo: "Compareceu à avaliação. Fechou plano de lentes em 8 dentes.",
    valor: 14400,
    tags: ["particular", "retorno"],
    atualizadoEm: dias(3),
    ultimoContatoEm: dias(4),
    campos: {
      procedimento_interesse: "lentes de contato dental",
      convenio: "particular",
    },
    mensagens: [
      { id: "m35", direction: "IN", author: "CONTACT", kind: "TEXT", text: "oi, queria marcar uma avaliação pra lentes", transcript: null, createdAt: dias(5) },
      { id: "m36", direction: "OUT", author: "BOT", kind: "TEXT", text: "Oi! Sou a Marina, da Clínica Sorriso Vivo 😊 Claro! Como você se chama?", transcript: null, createdAt: dias(5) },
      { id: "m37", direction: "IN", author: "CONTACT", kind: "TEXT", text: "Patrícia", transcript: null, createdAt: dias(4) },
    ],
    eventos: [
      { id: "v8", type: "stage_changed", body: "Avaliação agendada -> Compareceu", author: "humano", createdAt: dias(3) },
      { id: "v9", type: "note", body: "Fechou 8 lentes, entrada no PIX e o restante em 10x.", author: "humano", createdAt: dias(3) },
    ],
  }),
  cartao({
    id: "d8",
    estagioId: "e2",
    nome: "Diego Sampaio",
    telefone: "5511996667777",
    resumo: "Perguntou preço de implante e sumiu. Já recebeu 2 follow-ups sem resposta.",
    proximoPasso: "Última tentativa de follow-up em 3 dias",
    tags: ["comparando preço"],
    atualizadoEm: dias(2),
    ultimoContatoEm: dias(4),
    campos: { procedimento_interesse: "implante dentário" },
    mensagens: [
      { id: "m38", direction: "IN", author: "CONTACT", kind: "TEXT", text: "quanto é um implante?", transcript: null, createdAt: dias(4) },
      { id: "m39", direction: "OUT", author: "BOT", kind: "TEXT", text: "Oi! Sou a Marina, da Clínica Sorriso Vivo 😊 Nosso implante unitário, com pino e coroa, sai a partir de R$ 2.500. O valor fechado sai na avaliação, que é gratuita. Como você se chama?", transcript: null, createdAt: dias(4) },
      { id: "m40", direction: "OUT", author: "BOT", kind: "TEXT", text: "Oi! Passando pra saber se você ainda tem interesse no implante. Se quiser, já vejo um horário de avaliação pra você 😊", transcript: null, createdAt: dias(3) },
      { id: "m41", direction: "OUT", author: "BOT", kind: "TEXT", text: "Oi de novo! A avaliação é gratuita e a agenda da semana costuma fechar rápido. Quer que eu segure um horário?", transcript: null, createdAt: dias(2) },
    ],
    eventos: [
      { id: "v10", type: "followup", body: "Follow-up 2 de 3 enviado", author: "sistema", createdAt: dias(2) },
    ],
  }),
  cartao({
    id: "d9",
    estagioId: "e6",
    nome: "Sandra Oliveira",
    telefone: "5511992223333",
    resumo: "Procurava odontopediatra para o filho de 8 anos. Não atendemos essa idade.",
    tags: [],
    atualizadoEm: dias(6),
    ultimoContatoEm: dias(6),
    mensagens: [
      { id: "m42", direction: "IN", author: "CONTACT", kind: "TEXT", text: "vcs atendem criança de 8 anos?", transcript: null, createdAt: dias(6) },
      { id: "m43", direction: "OUT", author: "BOT", kind: "TEXT", text: "Oi! Sou a Marina, da Clínica Sorriso Vivo 😊 Infelizmente não temos odontopediatra, atendemos a partir dos 16 anos. Sinto muito não poder ajudar dessa vez!", transcript: null, createdAt: dias(6) },
    ],
    eventos: [
      { id: "v11", type: "stage_changed", body: "Novo lead -> Perdido: fora do perfil de atendimento (odontopediatria)", author: "ia", createdAt: dias(6) },
    ],
  }),
];

const AGENDAMENTOS: Agendamento[] = [
  { id: "a1", servico: "Avaliação", quando: AVALIACAO_CARLOS.toISOString(), duracaoMin: 40, status: "SCHEDULED", observacao: "Implante inferior, tem Amil Dental", dealId: "d2", nome: "Carlos Mendes", telefoneFormatado: "(11) 99123-4567" },
  { id: "a2", servico: "Avaliação", quando: AVALIACAO_ROBERTO.toISOString(), duracaoMin: 40, status: "CONFIRMED", observacao: "Clareamento antes do casamento da filha", dealId: "d6", nome: "Roberto Tanaka", telefoneFormatado: "(11) 99777-8888" },
  { id: "a3", servico: "Avaliação", quando: diaAberto(3, 10, 40).toISOString(), duracaoMin: 40, status: "SCHEDULED", observacao: null, dealId: null, nome: "Luana Prado", telefoneFormatado: "(11) 99555-1212" },
  // Passados: um sem desfecho (o dono esqueceu de marcar) e alguns já resolvidos.
  { id: "a4", servico: "Avaliação", quando: diaAbertoAntes(1, 10, 20).toISOString(), duracaoMin: 40, status: "CONFIRMED", observacao: null, dealId: null, nome: "Juliana Alves", telefoneFormatado: "(11) 98888-2222", criadoPor: "ia" },
  { id: "a5", servico: "Limpeza", quando: diaAbertoAntes(2, 9).toISOString(), duracaoMin: 40, status: "DONE", observacao: null, dealId: null, nome: "Fernanda Lima", telefoneFormatado: "(11) 97777-3333", criadoPor: "ia" },
  { id: "a6", servico: "Avaliação", quando: diaAbertoAntes(3, 11, 40).toISOString(), duracaoMin: 40, status: "NOSHOW", observacao: null, dealId: null, nome: "Diego Sampaio", telefoneFormatado: "(11) 96666-4444", criadoPor: "ia" },
  { id: "a7", servico: "Clareamento", quando: diaAbertoAntes(5, 10).toISOString(), duracaoMin: 60, status: "DONE", observacao: "Segunda sessão", dealId: null, nome: "Patrícia Nogueira", telefoneFormatado: "(11) 95555-5555", criadoPor: "humano" },
  { id: "a8", servico: "Avaliação", quando: diaAberto(1, 11, 20).toISOString(), duracaoMin: 40, status: "CANCELED", observacao: "viagem de trabalho, vai remarcar", dealId: null, nome: "Sandra Oliveira", telefoneFormatado: "(11) 94444-6666", criadoPor: "ia" },
];

/** As mesmas do negocio.exemplo.json: é o que o comprador vê no primeiro dia. */
const RESPOSTAS: RespostaRapida[] = [
  { id: "r1", atalho: "avaliacao", texto: "{nome}, a avaliação é gratuita e sem compromisso: você sai dela com o plano de tratamento e o orçamento fechado. Qual período fica melhor para você, manhã, tarde ou sábado?" },
  { id: "r2", atalho: "confirmar", texto: "Oi {nome}, tudo bem? Passando para confirmar seu horário aqui na Clínica Sorriso Vivo. Posso contar com a sua presença?" },
  { id: "r3", atalho: "documentos", texto: "Para a consulta, traga um documento com foto e, se for usar o convênio, a carteirinha do plano." },
  { id: "r4", atalho: "endereco", texto: "Nosso endereço é Rua das Acácias, 120 - Sala 4 - Pinheiros, São Paulo. Fica a 5 minutos a pé do metrô Fradique Coutinho, e temos convênio com o estacionamento do prédio." },
  { id: "r5", atalho: "retorno", texto: "Oi {nome}! Vou verificar com a equipe e já te retorno por aqui, tá bom?" },
];

// Estado mutavel: as acoes da tela precisam ter efeito visivel na demonstracao.
const BLOQUEIOS: Bloqueio[] = [
  {
    id: "b1",
    inicio: daquiAHoras(24 * 7),
    fim: daquiAHoras(24 * 7 + 10),
    motivo: "Feriado municipal",
  },
];

/**
 * Contatos = todo mundo do funil MAIS gente que so ligou ou veio de indicacao.
 * Isso deixa claro na demonstracao que contato e funil sao coisas diferentes.
 */
const CONTATOS_EXTRAS: ContatoResumo[] = [
  {
    id: "x1",
    nome: "Marcelo Arruda",
    telefone: "5511970001111",
    telefoneFormatado: "(11) 97000-1111",
    email: "marcelo@exemplo.com",
    tags: ["indicação"],
    estagio: null,
    dealId: null,
    agendamentos: 0,
    conversas: 0,
    criadoEm: dias(12),
  },
  {
    id: "x2",
    nome: "Beatriz Camargo",
    telefone: "5511970002222",
    telefoneFormatado: "(11) 97000-2222",
    email: null,
    tags: ["retorno"],
    estagio: null,
    dealId: null,
    agendamentos: 1,
    conversas: 0,
    criadoEm: dias(40),
  },
  {
    id: "x3",
    nome: "Rogério Pinto",
    telefone: "5511970003333",
    telefoneFormatado: "(11) 97000-3333",
    email: null,
    tags: [],
    estagio: null,
    dealId: null,
    agendamentos: 0,
    conversas: 0,
    criadoEm: dias(55),
  },
];

function contatosDosCartoes(): ContatoResumo[] {
  return CARTOES.map((c) => ({
    id: "ct-" + c.id,
    nome: c.nome,
    telefone: c.telefone,
    telefoneFormatado: c.telefoneFormatado,
    email: null,
    tags: c.tags,
    estagio: ESTAGIOS.find((e) => e.id === c.estagioId)?.nome ?? null,
    dealId: c.id,
    agendamentos: AGENDAMENTOS.filter((a) => a.dealId === c.id).length,
    conversas: 1,
    criadoEm: c.atualizadoEm,
  }));
}

const estado = {
  cartoes: CARTOES,
  agendamentos: AGENDAMENTOS,
  respostas: RESPOSTAS as RespostaRapida[],
  bloqueios: BLOQUEIOS,
  contatos: [...contatosDosCartoes(), ...CONTATOS_EXTRAS],
  conectado: true,
};

const espera = <T,>(valor: T, ms = 150): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(valor), ms));

const acharPorConversa = (conversaId: string) =>
  estado.cartoes.find((c) => c.conversaId === conversaId);

// Deixa a tela de login acessivel na demonstracao: "Sair" desloga de verdade,
// e qualquer e-mail/senha entra de novo.
let logado = true;
const perfilDemo: { email: string; nome: string; tema: "claro" | "escuro" | "sistema" } = {
  email: "voce@clinica.com.br",
  nome: "Dono",
  tema: "sistema",
};

export const apiDemo = {
  atualizarPerfil: (dados: { nome?: string; tema?: "claro" | "escuro" | "sistema" }) => {
    if (dados.nome) perfilDemo.nome = dados.nome;
    if (dados.tema) perfilDemo.tema = dados.tema;
    return espera({ ok: true as const });
  },

  trocarSenha: (_atual: string, nova: string) =>
    nova.length < 6
      ? Promise.reject(new ErroApi("A nova senha precisa ter pelo menos 6 caracteres.", 400))
      : espera({ ok: true as const }),

  eu: () =>
    logado
      ? espera({
          usuario: { ...perfilDemo },
          negocio: {
            nome: "Clínica Sorriso Vivo",
            atendente: "Marina",
            agendaAtiva: true,
            horarios: {
              seg: [["09:00", "19:00"]],
              ter: [["09:00", "19:00"]],
              qua: [["09:00", "19:00"]],
              qui: [["09:00", "19:00"]],
              sex: [["09:00", "18:00"]],
              sab: [["09:00", "13:00"]],
            } as HorariosSemana,
            servicos: [
              { nome: "Avaliação", duracaoMin: 40 },
              { nome: "Clareamento dental", duracaoMin: 60 },
              { nome: "Lentes de contato dental", duracaoMin: 90 },
              { nome: "Implante dentário", duracaoMin: 90 },
              { nome: "Harmonização facial", duracaoMin: 60 },
            ],
            rotulosDeCampos: {
              procedimento_interesse: "Procedimento de interesse",
              convenio: "Convênio ou particular",
              urgencia: "Urgência",
              melhor_periodo: "Melhor período",
            },
            etiquetas: [
              "convênio",
              "particular",
              "indicação",
              "comparando preço",
              "urgência",
              "retorno",
            ],
          },
        })
      : Promise.reject(new Error("sem sessao na demonstracao")),

  entrar: () => {
    logado = true;
    return espera({ ok: true as const });
  },

  sair: () => {
    logado = false;
    return espera({ ok: true as const });
  },

  resumo: (): Promise<Resumo> =>
    espera({
      novosHoje: 4,
      aguardando: estado.cartoes.filter((c) => c.aguardandoResposta).length,
      emAtendimentoHumano: estado.cartoes.filter((c) => c.modo === "HUMAN").length,
      agendadosHoje: 2,
      precisamDeVoce: estado.cartoes.filter(precisaDeVoceDemo).length,
    }),

  conversas: (filtro: "todas" | "voce" = "todas", busca = ""): Promise<ListaConversas> => {
    const termo = busca.trim().toLowerCase();
    const todas: ConversaResumo[] = estado.cartoes
      .filter((c) => c.mensagens.length > 0)
      .map((c) => {
        const ultima = c.mensagens[c.mensagens.length - 1]!;
        const precisa = precisaDeVoceDemo(c);
        return {
          id: c.conversaId!,
          negocioId: c.id,
          estagio: ESTAGIOS.find((e) => e.id === c.estagioId)?.nome ?? null,
          nome: c.nome,
          telefone: c.telefone,
          telefoneFormatado: c.telefoneFormatado,
          modo: c.modo,
          pausado: false,
          precisaDeVoce: precisa,
          esperandoDesde: ultima.direction === "IN" ? ultima.createdAt : null,
          ultimaMensagem: {
            texto: PREVIA[ultima.kind] ?? ultima.text ?? "",
            autor: ultima.author,
            em: ultima.createdAt,
          },
        };
      })
      .sort((a, b) => (b.ultimaMensagem!.em > a.ultimaMensagem!.em ? 1 : -1));

    const filtradas = todas
      .filter((c) => filtro === "todas" || c.modo === "HUMAN" || c.pausado)
      .filter(
        (c) =>
          !termo ||
          (c.nome ?? "").toLowerCase().includes(termo) ||
          c.telefone.includes(termo.replace(/\D/g, "") || "---"),
      );

    return espera({
      total: filtradas.length,
      mostrando: filtradas.length,
      precisamDeVoce: todas.filter((c) => c.precisaDeVoce).length,
      comVoce: todas.filter((c) => c.modo === "HUMAN" || c.pausado).length,
      conversas: filtradas,
    });
  },

  funil: (): Promise<{ estagios: Estagio[] }> =>
    espera({
      estagios: ESTAGIOS.map((e) => {
        const cards = estado.cartoes
          .filter((c) => c.estagioId === e.id)
          .map((c) => ({ ...c, aguardandoResposta: precisaDeVoceDemo(c) })) as Cartao[];
        return { ...e, total: cards.length, cards };
      }),
    }),

  lead: (id: string): Promise<Lead> => {
    const c = estado.cartoes.find((x) => x.id === id);
    if (!c) return Promise.reject(new Error("lead nao encontrado na demonstracao"));

    const e = ESTAGIOS.find((x) => x.id === c.estagioId)!;

    return espera({
      id: c.id,
      titulo: c.titulo,
      estagio: { id: e.id, chave: e.chave, nome: e.nome },
      status: "OPEN",
      valor: c.valor,
      resumo: c.resumo,
      proximoPasso: c.proximoPasso,
      criadoEm: c.atualizadoEm,
      ultimoContatoEm: c.ultimoContatoEm,
      contato: {
        id: "ct-" + c.id,
        nome: c.nome,
        pushName: c.nome,
        telefone: c.telefone,
        telefoneFormatado: c.telefoneFormatado,
        email: null,
        tags: c.tags,
        campos: c.campos,
      },
      conversa: {
        id: c.conversaId!,
        modo: c.modo,
        pausadoAte: null,
        motivoTransferencia:
          c.modo === "HUMAN" && c.tags.includes("urgência")
            ? "paciente relatou dor forte, caso de urgência"
            : null,
      },
      mensagens: c.mensagens,
      eventos: c.eventos,
      agendamentos: estado.agendamentos.filter((a) => a.dealId === c.id),
    });
  },

  moverLead: (id: string, estagioId: string) => {
    const c = estado.cartoes.find((x) => x.id === id);
    if (c) c.estagioId = estagioId;
    return espera({ ok: true as const });
  },

  comentar: (id: string, texto: string): Promise<Evento> => {
    const c = estado.cartoes.find((x) => x.id === id);
    const evento: Evento = {
      id: "ev-" + Date.now(),
      type: "comment",
      body: texto.trim(),
      author: "humano",
      createdAt: new Date().toISOString(),
    };
    if (c) c.eventos.unshift(evento);
    return espera(evento);
  },

  apagarComentario: (id: string, eventoId: string) => {
    const c = estado.cartoes.find((x) => x.id === id);
    if (c) c.eventos = c.eventos.filter((e) => e.id !== eventoId);
    return espera({ ok: true as const });
  },

  atualizarValor: (id: string, valor: number | null) => {
    const c = estado.cartoes.find((x) => x.id === id);
    if (c) c.valor = valor;
    return espera({ ok: true as const });
  },

  assumirConversa: (conversaId: string) => {
    const c = acharPorConversa(conversaId);
    if (c) {
      c.modo = "HUMAN";
      c.aguardandoResposta = false;
    }
    return espera({ ok: true as const });
  },

  devolverConversa: (conversaId: string) => {
    const c = acharPorConversa(conversaId);
    if (c) c.modo = "BOT";
    return espera({ ok: true as const });
  },

  enviarMensagem: (conversaId: string, texto: string) => {
    const c = acharPorConversa(conversaId);
    if (c) {
      c.mensagens = [
        ...c.mensagens,
        {
          id: "m-" + Date.now(),
          direction: "OUT",
          author: "HUMAN",
          kind: "TEXT",
          text: texto,
          transcript: null,
          createdAt: new Date().toISOString(),
        },
      ];
      c.modo = "HUMAN";
      c.aguardandoResposta = false;
      c.ultimoContatoEm = new Date().toISOString();
    }
    return espera({ ok: true as const });
  },

  /** Sem servidor: o arquivo fica só neste navegador, o bastante para demonstrar. */
  enviarArquivo: (conversaId: string, arquivo: Blob, opcoes: OpcoesArquivo) => {
    const c = acharPorConversa(conversaId);
    if (c) {
      const tipo = opcoes.voz
        ? "AUDIO"
        : opcoes.tipo.startsWith("image/")
          ? "IMAGE"
          : opcoes.tipo.startsWith("video/")
            ? "VIDEO"
            : opcoes.tipo.startsWith("audio/")
              ? "AUDIO"
              : "DOCUMENT";
      c.mensagens = [
        ...c.mensagens,
        {
          id: "m-" + Date.now() + Math.random(),
          direction: "OUT",
          author: "HUMAN",
          kind: tipo,
          text: opcoes.legenda ?? null,
          transcript: null,
          createdAt: new Date().toISOString(),
          midia: {
            url: URL.createObjectURL(arquivo),
            mime: opcoes.tipo,
            nome: opcoes.voz ? null : opcoes.nome,
            tamanho: arquivo.size,
            // O WebM gravado pelo Chrome não informa a duração; o servidor de verdade
            // converte para OGG, que informa. Aqui, sem servidor, ela vai junto.
            segundos: opcoes.voz?.segundos ?? null,
          },
        },
      ];
      c.modo = "HUMAN";
      c.aguardandoResposta = false;
      c.ultimoContatoEm = new Date().toISOString();
    }
    return espera({ ok: true as const });
  },

  agenda: (aba: AbaAgenda = "proximos", busca = ""): Promise<ListaAgenda> => {
    const agora = Date.now();
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const termo = busca.trim().toLowerCase();
    const comDesfecho = estado.agendamentos.map((a) => ({
      ...a,
      semDesfecho:
        new Date(a.quando).getTime() < agora && (a.status === "SCHEDULED" || a.status === "CONFIRMED"),
    }));
    const daAba = (x: AbaAgenda) =>
      comDesfecho.filter((a) =>
        x === "cancelados"
          ? a.status === "CANCELED"
          : a.status !== "CANCELED" &&
            (x === "proximos"
              ? new Date(a.quando) >= hoje
              : new Date(a.quando) < hoje),
      );
    const itens = daAba(aba)
      .filter((a) => !termo || (a.nome ?? "").toLowerCase().includes(termo))
      .sort((a, b) => (aba === "proximos" ? 1 : -1) * (a.quando > b.quando ? 1 : -1));
    return espera({
      aba,
      total: itens.length,
      contagens: {
        proximos: daAba("proximos").length,
        passados: daAba("passados").length,
        cancelados: daAba("cancelados").length,
        semDesfecho: comDesfecho.filter((a) => a.semDesfecho).length,
      },
      itens,
    });
  },

  respostasRapidas: () => espera([...estado.respostas]),

  salvarRespostaRapida: (dados: { id?: string; atalho: string; texto: string }) => {
    const atalho = dados.atalho
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/^\/+/, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    if (!atalho) return Promise.reject(new ErroApi("O atalho precisa ter pelo menos uma letra ou número.", 400));
    if (estado.respostas.some((r) => r.atalho === atalho && r.id !== dados.id)) {
      return Promise.reject(new ErroApi(`Já existe uma resposta com o atalho /${atalho}. Escolha outro.`, 400));
    }
    const salva = { id: dados.id ?? "r-" + Date.now(), atalho, texto: dados.texto.trim() };
    estado.respostas = [...estado.respostas.filter((r) => r.id !== salva.id), salva].sort((a, b) =>
      a.atalho.localeCompare(b.atalho),
    );
    return espera(salva);
  },

  apagarRespostaRapida: (id: string) => {
    estado.respostas = estado.respostas.filter((r) => r.id !== id);
    return espera(undefined);
  },

  atualizarAgendamento: (id: string, status: Agendamento["status"]) => {
    const a = estado.agendamentos.find((x) => x.id === id);
    if (a) {
      a.status = status;
      // Como no servidor: "compareceu" leva o card para Compareceu; desfazer devolve.
      const c = estado.cartoes.find((x) => x.id === a.dealId);
      if (c && status === "DONE") c.estagioId = "e5";
      else if (c && c.estagioId === "e5") c.estagioId = "e4";
    }
    return espera({ ok: true as const });
  },

  agendaPeriodo: (de: Date, ate: Date): Promise<PeriodoAgenda> => {
    const agora = Date.now();
    return espera({
      agendamentos: estado.agendamentos
        .filter((a) => a.status !== "CANCELED")
        .filter((a) => new Date(a.quando) >= de && new Date(a.quando) < ate)
        .map((a) => ({
          ...a,
          semDesfecho:
            new Date(a.quando).getTime() < agora && (a.status === "SCHEDULED" || a.status === "CONFIRMED"),
        })),
      bloqueios: estado.bloqueios.filter((b) => new Date(b.inicio) < ate && new Date(b.fim) > de),
    });
  },

  /** Slots ficticios: 09:00 as 19:00, de 40 em 40, tirando o que ja esta ocupado. */
  horariosLivres: (opcoes: { dia?: string; servico?: string; ignorar?: string } = {}) => {
    const dia = opcoes.dia ?? new Date().toISOString().slice(0, 10);
    const ocupados = new Set(
      estado.agendamentos
        .filter((a) => a.status !== "CANCELED" && a.id !== opcoes.ignorar)
        .map((a) => a.quando.slice(0, 16)),
    );

    const bloqueados = estado.bloqueios.map((b) => ({
      inicio: new Date(b.inicio).getTime(),
      fim: new Date(b.fim).getTime(),
    }));

    const livres: HorarioLivre[] = [];
    for (let minuto = 9 * 60; minuto + 40 <= 19 * 60; minuto += 40) {
      const hh = String(Math.floor(minuto / 60)).padStart(2, "0");
      const mm = String(minuto % 60).padStart(2, "0");
      const valor = `${dia}T${hh}:${mm}`;
      const instante = new Date(valor).getTime();

      if (instante < Date.now()) continue;
      if (ocupados.has(valor)) continue;
      if (bloqueados.some((b) => instante >= b.inicio && instante < b.fim)) continue;

      livres.push({
        valor,
        rotulo: new Date(valor).toLocaleString("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
    }
    return espera(livres);
  },

  criarAgendamento: (dados: {
    telefone: string;
    nome?: string;
    servico: string;
    dataHora: string;
    observacao?: string;
  }) => {
    const id = "a-" + Date.now();
    estado.agendamentos = [
      ...estado.agendamentos,
      {
        id,
        servico: dados.servico,
        quando: new Date(dados.dataHora).toISOString(),
        duracaoMin: 40,
        status: "SCHEDULED" as const,
        observacao: dados.observacao ?? null,
        dealId: null,
        nome: dados.nome ?? "Sem nome",
        telefoneFormatado: dados.telefone,
      },
    ].sort((a, b) => a.quando.localeCompare(b.quando));
    return espera({ ok: true as const, id });
  },

  remarcarAgendamento: (id: string, dataHora: string) => {
    const a = estado.agendamentos.find((x) => x.id === id);
    if (a) {
      a.quando = new Date(dataHora).toISOString();
      a.status = "SCHEDULED";
    }
    estado.agendamentos = [...estado.agendamentos].sort((x, y) =>
      x.quando.localeCompare(y.quando),
    );
    return espera({ ok: true as const });
  },

  cancelarAgendamento: (id: string, motivo?: string) => {
    const a = estado.agendamentos.find((x) => x.id === id);
    if (a) {
      a.status = "CANCELED";
      if (motivo) a.observacao = motivo;
    }
    return espera({ ok: true as const });
  },

  // -------------------------------------------------------------- contatos

  contatos: (busca = "", pagina = 1): Promise<ListaContatos> => {
    const termo = busca.trim().toLowerCase();
    const filtrados = termo
      ? estado.contatos.filter(
          (c) =>
            (c.nome ?? "").toLowerCase().includes(termo) ||
            (c.email ?? "").toLowerCase().includes(termo) ||
            c.telefone.includes(termo.replace(/\D/g, "")),
        )
      : estado.contatos;

    const porPagina = 50;
    return espera({
      total: filtrados.length,
      pagina,
      porPagina,
      contatos: filtrados.slice((pagina - 1) * porPagina, pagina * porPagina),
    });
  },

  criarContato: (dados: { telefone: string; nome?: string; email?: string; tags?: string[] }) => {
    const digitos = dados.telefone.replace(/\D/g, "");
    if (estado.contatos.some((c) => c.telefone.endsWith(digitos.slice(-8)))) {
      return Promise.reject(new ErroApi("Esse telefone já está salvo.", 409));
    }

    const id = "ct-" + Date.now();
    estado.contatos = [
      {
        id,
        nome: dados.nome ?? null,
        telefone: digitos.startsWith("55") ? digitos : "55" + digitos,
        telefoneFormatado: dados.telefone,
        email: dados.email ?? null,
        tags: dados.tags ?? [],
        estagio: null,
        dealId: null,
        agendamentos: 0,
        conversas: 0,
        criadoEm: new Date().toISOString(),
      },
      ...estado.contatos,
    ];
    return espera({ ok: true as const, id });
  },

  atualizarContato: (
    id: string,
    dados: {
      nome?: string | null;
      email?: string | null;
      tags?: string[];
      campos?: Record<string, string>;
    },
  ) => {
    const contato = estado.contatos.find((c) => c.id === id);
    if (contato) {
      if (dados.nome !== undefined) contato.nome = dados.nome;
      if (dados.email !== undefined) contato.email = dados.email;
      if (dados.tags) contato.tags = dados.tags;
    }
    // Na demonstracao, a janela do lead le do card ("ct-" + id do card).
    const cartao = estado.cartoes.find((c) => "ct-" + c.id === id);
    if (cartao) {
      if (dados.nome !== undefined) cartao.nome = dados.nome;
      if (dados.tags) cartao.tags = dados.tags;
      if (dados.campos) {
        for (const [chave, valor] of Object.entries(dados.campos)) {
          if (valor.trim()) cartao.campos[chave] = valor.trim();
          else delete cartao.campos[chave];
        }
      }
    }
    return espera({ ok: true as const });
  },

  apagarContato: (id: string) => {
    estado.contatos = estado.contatos.filter((c) => c.id !== id);
    return espera({ ok: true as const, apagados: { conversations: 1, deals: 1, appointments: 0 } });
  },

  exportarContatos: () => {
    const cabecalho = "telefone;nome;email;tags;estagio";
    const linhas = estado.contatos.map((c) =>
      [c.telefone, c.nome ?? "", c.email ?? "", c.tags.join("|"), c.estagio ?? ""]
        .map((v) => (v.includes(";") ? `"${v}"` : v))
        .join(";"),
    );
    return espera("﻿" + [cabecalho, ...linhas].join("\r\n") + "\r\n");
  },

  importarContatos: (csv: string): Promise<ResultadoImportacao> => {
    const linhas = csv
      .replace(/^﻿/, "")
      .split(/\r?\n/)
      .filter((l) => l.trim());
    const corpo = linhas.slice(1);

    let criados = 0;
    for (const linha of corpo) {
      const [telefone, nome] = linha.split(/[;,]/);
      const digitos = (telefone ?? "").replace(/\D/g, "");
      if (digitos.length < 10) continue;
      if (estado.contatos.some((c) => c.telefone.endsWith(digitos.slice(-8)))) continue;

      estado.contatos = [
        {
          id: "ct-imp-" + criados + "-" + Date.now(),
          nome: (nome ?? "").trim() || null,
          telefone: digitos.startsWith("55") ? digitos : "55" + digitos,
          telefoneFormatado: digitos,
          email: null,
          tags: [],
          estagio: null,
          dealId: null,
          agendamentos: 0,
          conversas: 0,
          criadoEm: new Date().toISOString(),
        },
        ...estado.contatos,
      ];
      criados++;
    }

    return espera({
      ok: true as const,
      criados,
      atualizados: 0,
      lidas: corpo.length,
      problemas: corpo.length - criados > 0 ? [`${corpo.length - criados} linha(s) ignorada(s)`] : [],
    });
  },

  // ---------------------------------------------------------------- painel

  painel: (): Promise<PainelDados> => {
    const serie = Array.from({ length: 14 }, (_, i) => {
      const data = new Date(Date.now() - (13 - i) * 86_400_000);
      // Números plausíveis: mais movimento no meio da semana, nada no domingo.
      const diaSemana = data.getDay();
      const base = diaSemana === 0 ? 0 : diaSemana === 6 ? 2 : 3 + ((i * 7) % 5);
      return {
        dia: data.toISOString().slice(0, 10),
        rotulo: data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        quantidade: base,
      };
    });

    return espera({
      contatos: {
        total: estado.contatos.length,
        hoje: 4,
        semana: 19,
        mes: 63,
      },
      atencao: {
        // A mesma conta da barra lateral e da caixa de entrada, como no servidor.
        aguardandoResposta: estado.cartoes.filter(precisaDeVoceDemo).length,
        emAtendimentoHumano: estado.cartoes.filter((c) => c.modo === "HUMAN").length,
      },
      funil: ESTAGIOS.map((e) => ({
        nome: e.nome,
        chave: e.chave,
        total: estado.cartoes.filter((c) => c.estagioId === e.id).length,
        ganho: e.ganho,
        perdido: e.perdido,
      })),
      autonomia: { conversas30: 63, precisaramDeHumano: 9, percentualResolvidoPelaIa: 86 },
      mensagens: { recebidas: 741, enviadasPelaIa: 812, enviadasPorHumano: 96 },
      agenda: {
        proximos7Dias: estado.agendamentos.filter((a) => a.status !== "CANCELED").length,
        marcadosPelaIa30: 27,
        compareceu: 21,
        faltou: 4,
        percentualComparecimento: 84,
      },
      serieNovosLeads: serie,
      uso: {
        modelo: "claude-haiku-4-5",
        chamadas: 1284,
        tokensEntrada: 5_920_000,
        tokensSaida: 214_000,
        aproveitamentoCache: 91,
      },
    });
  },

  bloqueios: (): Promise<Bloqueio[]> => espera(estado.bloqueios),

  criarBloqueio: (dados: { inicio: string; fim: string; motivo?: string }) => {
    const id = "b-" + Date.now();
    const inicio = new Date(dados.inicio).getTime();
    const fim = new Date(dados.fim).getTime();

    const noPeriodo = estado.agendamentos.filter((a) => {
      const t = new Date(a.quando).getTime();
      return a.status !== "CANCELED" && t >= inicio && t < fim;
    }).length;

    estado.bloqueios = [
      ...estado.bloqueios,
      {
        id,
        inicio: new Date(dados.inicio).toISOString(),
        fim: new Date(dados.fim).toISOString(),
        motivo: dados.motivo ?? null,
      },
    ].sort((a, b) => a.inicio.localeCompare(b.inicio));

    return espera({ ok: true as const, id, agendamentosNoPeriodo: noPeriodo });
  },

  removerBloqueio: (id: string) => {
    estado.bloqueios = estado.bloqueios.filter((b) => b.id !== id);
    return espera({ ok: true as const });
  },

  statusWhatsapp: (): Promise<StatusWhatsapp> =>
    espera({
      estado: estado.conectado ? "open" : "close",
      conectado: estado.conectado,
      descricao: estado.conectado
        ? "WhatsApp conectado."
        : "WhatsApp desconectado. Gere o QR Code para conectar.",
      conta: estado.conectado
        ? {
            telefone: "5511940028922",
            telefoneFormatado: "(11) 94002-8922",
            nome: "Clínica Sorriso Vivo",
            foto: null,
            desde: dias(3),
          }
        : null,
      atividade: estado.conectado
        ? { recebidasHoje: 47, respondidasHoje: 52, ultimaRecebidaEm: minutos(4) }
        : null,
    }),

  desconectarWhatsapp: () => {
    estado.conectado = false;
    return espera({ ok: true as const });
  },

  conectarWhatsapp: () => {
    // Sem WhatsApp de verdade: "conecta" na hora, para a demonstração seguir.
    estado.conectado = true;
    return espera({
      qrcode: null,
      codigo: "DEMO-1234",
      instrucao: "Modo demonstração: nenhum WhatsApp real é conectado aqui.",
    });
  },
};
