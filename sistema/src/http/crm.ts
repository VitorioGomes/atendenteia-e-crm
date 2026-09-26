import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { z } from "zod";
import { getNegocio } from "../config/negocio.js";
import { garantirLead } from "../crm/leads.js";
import { formatarSlot, horariosDisponiveis } from "../agenda/slots.js";
import {
  cancelarAgendamento,
  cancelarLembrete,
  criarAgendamento,
  registrarDesfecho,
  duracaoDoServico,
  remarcarAgendamento,
} from "../agenda/agendamentos.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { formatarTelefone } from "../lib/telefone.js";
import { lerEtiquetas, paraCentavos, paraReais } from "../lib/estados.js";
import { enviarTexto } from "../whatsapp/conexao.js";
import { cancelarFollowup } from "../atendimento/followup.js";
import { cancelarResposta } from "../atendimento/buffer.js";
import { registrarEnvioDaEquipe } from "../atendimento/envio-da-equipe.js";
import { exigirLogin } from "./api.js";
import { SELECAO_MENSAGEM, mensagemParaTela } from "./mensagem.js";
import { filtroPrecisaDeVoce } from "./conversas.js";
import { precisaDeVoce } from "../crm/atencao.js";

/**
 * API do CRM.
 *
 * Tudo aqui e lido por uma pessoa apressada olhando o celular entre um cliente e outro.
 * Por isso os campos ja saem prontos para exibir (telefone formatado, texto do ultimo
 * contato) em vez de empurrar a formatacao pro front.
 */

// O banco guarda centavos (inteiro); a API e a tela falam em reais.
const dinheiro = paraReais;

/**
 * As regras de agenda escrevem para a IA ler (sem acento, "nao encontrei"). Na tela vai
 * o texto de gente, com acento e dizendo o que fazer (revisao geral de 26/09/2026:
 * antes a recepcao lia "Esse horario acabou de ser ocupado."). Motivo sem traducao
 * sai como veio, com a primeira letra maiuscula.
 */
const MOTIVOS_NA_TELA: Record<string, string> = {
  "a agenda esta desligada na configuracao do negocio.":
    "A agenda está desligada. Peça para ligar a agenda na configuração do sistema.",
  "a data informada nao e valida.": "A data não é válida. Confira o dia e a hora.",
  "nao encontrei esse agendamento.": "Esse agendamento não existe mais. Recarregue a página.",
  "esse agendamento foi cancelado; marque um novo.":
    "Esse agendamento foi cancelado. Para outro horário, crie um novo agendamento.",
  "esse agendamento ja estava cancelado.": "Esse agendamento já estava cancelado.",
  "esse horario acabou de ser ocupado.": "Esse horário já está ocupado. Escolha outro.",
};
const maiuscula = (texto: string): string =>
  MOTIVOS_NA_TELA[texto] ?? texto.charAt(0).toUpperCase() + texto.slice(1);

type AgendamentoComContato = Prisma.AppointmentGetPayload<{
  include: { contact: { select: { name: true; pushName: true; phone: true } } };
}>;

function agendamentoParaTela(a: AgendamentoComContato, agora: Date) {
  return {
    id: a.id,
    servico: a.service,
    quando: a.scheduledAt,
    duracaoMin: a.durationMin,
    status: a.status,
    observacao: a.notes,
    dealId: a.dealId,
    criadoPor: a.createdBy,
    nome: a.contact.name ?? a.contact.pushName,
    telefone: a.contact.phone,
    telefoneFormatado: formatarTelefone(a.contact.phone),
    // Passou do horario e ninguem disse se a pessoa veio.
    semDesfecho: a.scheduledAt < agora && (a.status === "SCHEDULED" || a.status === "CONFIRMED"),
  };
}

/** Uma aba da agenda mostra no maximo isto; a busca acha o resto. */
const LIMITE_AGENDA = 150;

const ROTULO_STATUS: Record<string, string> = {
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
  CANCELED: "Cancelado",
  DONE: "Compareceu",
  NOSHOW: "Não veio",
};

export async function rotasCrm(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", exigirLogin);

  // -------------------------------------------------------------------------
  // Funil (kanban)
  // -------------------------------------------------------------------------

  /**
   * Quantos cards cada coluna entrega por vez.
   *
   * Existe porque card ganho nunca sai do funil: depois de um ano, a coluna
   * "Compareceu" de uma clinica movimentada teria milhares de cards sendo
   * serializados a cada 10 segundos. O banco aguenta, a tela e a rede nao.
   * A contagem total continua vindo, entao nada parece ter sumido.
   */
  const LIMITE_POR_ESTAGIO = 60;

  const INCLUIR_CONVERSA = {
    contact: {
      include: {
        conversations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            mode: true,
            botPausedUntil: true,
            lastInboundAt: true,
            lastOutboundAt: true,
          },
        },
      },
    },
  } as const;

  app.get("/api/funil", async () => {
    const estagios = await db.stage.findMany({ orderBy: { position: "asc" } });

    // Uma consulta por coluna, cada uma limitada e servida pelo indice
    // (stageId, updatedAt). Antes era uma consulta unica sem teto nenhum.
    const colunas = await Promise.all(
      estagios.map(async (estagio) => {
        const [negocios, total] = await Promise.all([
          db.deal.findMany({
            where: { stageId: estagio.id },
            orderBy: { updatedAt: "desc" },
            take: LIMITE_POR_ESTAGIO,
            include: INCLUIR_CONVERSA,
          }),
          db.deal.count({ where: { stageId: estagio.id } }),
        ]);
        return { estagio, negocios, total };
      }),
    );

    const agora = new Date();
    // O estagio de agendado mora na configuracao, nao no banco. A coluna dele ganha
    // icone proprio: e onde o atendente entrega o resultado.
    const chavesDeAgendado = new Set(
      getNegocio().negocio.funil.estagios.filter((e) => e.aoAgendar).map((e) => e.chave),
    );

    return {
      estagios: colunas.map(({ estagio, negocios, total }) => ({
        id: estagio.id,
        chave: estagio.key,
        nome: estagio.name,
        ganho: estagio.isWon,
        perdido: estagio.isLost,
        agendado: chavesDeAgendado.has(estagio.key),
        total,
        cards: negocios.map((n) => {
          const conversa = n.contact.conversations[0];

          // Card laranja = alguem esperando uma PESSOA, pela mesma regra de Conversas e
          // da barra lateral (crm/atencao.ts). Antes bastava a mensagem estar sem
          // resposta, e todo card acendia nos segundos em que a IA ainda digitava.
          const aguardando = conversa ? precisaDeVoce(conversa, agora) : false;

          return {
            id: n.id,
            estagioId: n.stageId,
            titulo: n.title,
            nome: n.contact.name,
            telefone: n.contact.phone,
            telefoneFormatado: formatarTelefone(n.contact.phone),
            resumo: n.summary,
            proximoPasso: n.nextStep,
            valor: dinheiro(n.valueCents),
            tags: lerEtiquetas(n.contact.tags),
            atualizadoEm: n.updatedAt,
            ultimoContatoEm: conversa?.lastInboundAt ?? null,
            conversaId: conversa?.id ?? null,
            modo: conversa?.mode ?? "BOT",
            pausado: Boolean(conversa?.botPausedUntil && conversa.botPausedUntil > agora),
            aguardandoResposta: aguardando,
          };
        }),
      })),
    };
  });

  // -------------------------------------------------------------------------
  // Detalhe do lead
  // -------------------------------------------------------------------------

  app.get("/api/negocios/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const negocio = await db.deal.findUnique({
      where: { id },
      include: {
        stage: true,
        contact: true,
        events: { orderBy: { createdAt: "desc" }, take: 50 },
        appointments: {
          orderBy: { scheduledAt: "asc" },
          include: { contact: { select: { name: true, pushName: true, phone: true } } },
        },
      },
    });

    if (!negocio) return reply.code(404).send({ erro: "Esse lead não existe mais. Recarregue a página." });

    const conversa = await db.conversation.findFirst({
      where: { contactId: negocio.contactId },
      orderBy: { createdAt: "desc" },
    });

    const mensagens = conversa
      ? await db.message.findMany({
          where: { conversationId: conversa.id },
          orderBy: { createdAt: "asc" },
          take: 200,
          select: SELECAO_MENSAGEM,
        })
      : [];

    return {
      id: negocio.id,
      titulo: negocio.title,
      estagio: { id: negocio.stage.id, chave: negocio.stage.key, nome: negocio.stage.name },
      status: negocio.status,
      valor: dinheiro(negocio.valueCents),
      resumo: negocio.summary,
      proximoPasso: negocio.nextStep,
      // Quando o lead entrou no funil e quando falou pela ultima vez: sem os dois, a
      // gaveta do funil so sabe dizer o que o card ja mostra.
      criadoEm: negocio.createdAt,
      ultimoContatoEm: mensagens.at(-1)?.createdAt ?? null,
      contato: {
        id: negocio.contact.id,
        nome: negocio.contact.name,
        pushName: negocio.contact.pushName,
        telefone: negocio.contact.phone,
        telefoneFormatado: formatarTelefone(negocio.contact.phone),
        email: negocio.contact.email,
        tags: lerEtiquetas(negocio.contact.tags),
        campos: negocio.contact.fields,
      },
      conversa: conversa
        ? {
            id: conversa.id,
            modo: conversa.mode,
            pausadoAte: conversa.botPausedUntil,
            motivoTransferencia: conversa.handoffReason,
          }
        : null,
      mensagens: mensagens.map(mensagemParaTela),
      eventos: negocio.events,
      // Mesmo formato da Agenda. Antes ia o registro cru do banco (service, scheduledAt),
      // e a gaveta lia servico e quando: saia ", Invalid Date as Invalid Date".
      agendamentos: negocio.appointments.map((a) => agendamentoParaTela(a, new Date())),
    };
  });

  // Comentario da equipe na atividade do lead (pedido do dono, 26/09/2026). Vive
  // junto do historico, como evento "comment", e so ele pode ser apagado: o resto
  // da atividade e registro do que aconteceu.
  app.post("/api/negocios/:id/comentarios", async (req, reply) => {
    const { id } = req.params as { id: string };
    const corpo = z.object({ texto: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!corpo.success) return reply.code(400).send({ erro: "Escreva o comentário antes de salvar." });

    const negocio = await db.deal.findUnique({ where: { id }, select: { id: true } });
    if (!negocio) return reply.code(404).send({ erro: "Esse lead não existe mais. Recarregue a página." });

    const evento = await db.dealEvent.create({
      data: { dealId: id, type: "comment", body: corpo.data.texto, author: "humano" },
    });
    return evento;
  });

  app.delete("/api/negocios/:id/comentarios/:eventoId", async (req, reply) => {
    const { id, eventoId } = req.params as { id: string; eventoId: string };
    const apagados = await db.dealEvent.deleteMany({
      where: { id: eventoId, dealId: id, type: "comment" },
    });
    if (apagados.count === 0) return reply.code(404).send({ erro: "Esse comentário não existe mais. Recarregue a página." });
    return { ok: true };
  });

  app.patch("/api/negocios/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const corpo = z
      .object({
        estagioId: z.string().optional(),
        valor: z.number().nullable().optional(),
        proximoPasso: z.string().nullable().optional(),
      })
      .safeParse(req.body);

    if (!corpo.success) return reply.code(400).send({ erro: "Dados inválidos. Recarregue a página e tente de novo." });

    const atual = await db.deal.findUnique({ where: { id }, include: { stage: true } });
    if (!atual) return reply.code(404).send({ erro: "Esse lead não existe mais. Recarregue a página." });

    let statusNovo = atual.status;
    if (corpo.data.estagioId && corpo.data.estagioId !== atual.stageId) {
      const destino = await db.stage.findUnique({ where: { id: corpo.data.estagioId } });
      if (!destino) return reply.code(400).send({ erro: "Esse estágio não existe mais. Recarregue a página." });

      statusNovo = destino.isWon ? "WON" : destino.isLost ? "LOST" : "OPEN";

      await db.dealEvent.create({
        data: {
          dealId: id,
          type: "stage_changed",
          body: `${atual.stage.name} -> ${destino.name}`,
          author: "humano",
        },
      });
    }

    const atualizado = await db.deal.update({
      where: { id },
      data: {
        stageId: corpo.data.estagioId ?? atual.stageId,
        status: statusNovo,
        // null apaga o valor (o dono limpou o campo); ausente mantem.
        valueCents:
          corpo.data.valor === undefined
            ? atual.valueCents
            : corpo.data.valor === null
              ? null
              : paraCentavos(corpo.data.valor),
        nextStep: corpo.data.proximoPasso ?? atual.nextStep,
      },
    });

    // Dono deu o lead por encerrado: a IA nao pode acordar depois para cutucar
    // quem ele ja descartou (nem para parabenizar quem ja fechou).
    if (statusNovo !== "OPEN" && atual.status === "OPEN") {
      const conversa = await db.conversation.findFirst({
        where: { contactId: atual.contactId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (conversa) await cancelarFollowup(conversa.id);
    }

    return { ok: true, id: atualizado.id };
  });

  // -------------------------------------------------------------------------
  // Conversa
  // -------------------------------------------------------------------------

  /** Dono assume a conversa: a IA para de responder ate ele devolver. */
  app.post("/api/conversas/:id/assumir", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conversa = await db.conversation.findUnique({ where: { id } });
    if (!conversa) return reply.code(404).send({ erro: "Essa conversa não existe mais. Recarregue a página." });

    cancelarResposta(id);
    await cancelarFollowup(id);
    await db.conversation.update({
      where: { id },
      data: { mode: "HUMAN", handoffReason: "Assumida pela equipe no CRM", botPausedUntil: null },
    });

    return { ok: true, modo: "HUMAN" };
  });

  app.post("/api/conversas/:id/devolver", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conversa = await db.conversation.findUnique({ where: { id } });
    if (!conversa) return reply.code(404).send({ erro: "Essa conversa não existe mais. Recarregue a página." });

    await db.conversation.update({
      where: { id },
      data: { mode: "BOT", handoffReason: null, botPausedUntil: null },
    });

    return { ok: true, modo: "BOT" };
  });

  /** Mensagem escrita pelo dono dentro do CRM. */
  app.post("/api/conversas/:id/mensagens", async (req, reply) => {
    const { id } = req.params as { id: string };
    const corpo = z.object({ texto: z.string().min(1).max(4000) }).safeParse(req.body);
    if (!corpo.success) return reply.code(400).send({ erro: "Escreva uma mensagem." });

    const conversa = await db.conversation.findUnique({
      where: { id },
      include: { contact: true },
    });
    if (!conversa) return reply.code(404).send({ erro: "Essa conversa não existe mais. Recarregue a página." });

    try {
      const { id: idExterno } = await enviarTexto(conversa.contact.phone, corpo.data.texto);

      await db.message.create({
        data: {
          conversationId: id,
          direction: "OUT",
          author: "HUMAN",
          kind: "TEXT",
          text: corpo.data.texto,
          externalId: idExterno ?? null,
        },
      });

      await registrarEnvioDaEquipe(id);

      return { ok: true };
    } catch (e) {
      logger.error({ err: e, conversaId: id }, "falha ao enviar mensagem manual");
      return reply.code(502).send({
        erro:
          "A mensagem não foi enviada. Confira se o WhatsApp está conectado na tela de Conexão.",
      });
    }
  });

  // -------------------------------------------------------------------------
  // Agenda
  // -------------------------------------------------------------------------

  /**
   * A agenda em tres abas, na ordem em que quem atende precisa delas: o que vem
   * (desde o INICIO de hoje — o paciente das 9h nao pode sumir as 9h01, e e justo ele
   * que precisa ser marcado como "compareceu"), o que passou e o que foi cancelado.
   */
  app.get("/api/agenda", async (req) => {
    const { aba, busca } = req.query as { aba?: string; busca?: string };
    const zona = getNegocio().negocio.horarios.timezone;
    const agora = new Date();
    const inicioDeHoje = DateTime.now().setZone(zona).startOf("day").toJSDate();

    const termo = (busca ?? "").trim();
    const digitos = termo.replace(/\D/g, "");
    const filtroBusca: Prisma.AppointmentWhereInput = termo
      ? {
          contact: {
            OR: [
              { name: { contains: termo } },
              { pushName: { contains: termo } },
              ...(digitos.length >= 3 ? [{ phone: { contains: digitos } }] : []),
            ],
          },
        }
      : {};

    const onde: Record<string, Prisma.AppointmentWhereInput> = {
      proximos: { scheduledAt: { gte: inicioDeHoje }, status: { not: "CANCELED" } },
      passados: { scheduledAt: { lt: inicioDeHoje }, status: { not: "CANCELED" } },
      cancelados: { status: "CANCELED" },
    };
    const escolhida = aba && aba in onde ? aba : "proximos";

    // Passou do horario e ninguem disse se a pessoa veio. Sem isso a taxa de
    // comparecimento do Painel mente — e ela e o numero que o dono mais quer ver.
    const semDesfecho: Prisma.AppointmentWhereInput = {
      scheduledAt: { lt: agora },
      status: { in: ["SCHEDULED", "CONFIRMED"] },
    };

    const [itens, total, proximos, passados, cancelados, pendentes] = await Promise.all([
      db.appointment.findMany({
        where: { AND: [onde[escolhida]!, filtroBusca] },
        orderBy: { scheduledAt: escolhida === "proximos" ? "asc" : "desc" },
        take: LIMITE_AGENDA,
        include: { contact: { select: { name: true, pushName: true, phone: true } } },
      }),
      db.appointment.count({ where: { AND: [onde[escolhida]!, filtroBusca] } }),
      db.appointment.count({ where: onde.proximos! }),
      db.appointment.count({ where: onde.passados! }),
      db.appointment.count({ where: onde.cancelados! }),
      db.appointment.count({ where: semDesfecho }),
    ]);

    return {
      aba: escolhida,
      total,
      contagens: { proximos, passados, cancelados, semDesfecho: pendentes },
      itens: itens.map((a) => agendamentoParaTela(a, agora)),
    };
  });

  /**
   * Tudo de um periodo, para a grade (dia, semana, mes): agendamentos que nao foram
   * cancelados e os bloqueios que encostam no periodo.
   */
  app.get("/api/agenda/periodo", async (req, reply) => {
    const { de, ate } = req.query as { de?: string; ate?: string };
    const inicio = new Date(de ?? "");
    const fim = new Date(ate ?? "");
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || fim <= inicio) {
      return reply.code(400).send({ erro: "Período inválido. Recarregue a página." });
    }
    if (fim.getTime() - inicio.getTime() > 45 * 86_400_000) {
      return reply.code(400).send({ erro: "Período longo demais: no máximo 45 dias." });
    }

    const agora = new Date();
    const [agendamentos, bloqueios] = await Promise.all([
      db.appointment.findMany({
        where: { scheduledAt: { gte: inicio, lt: fim }, status: { not: "CANCELED" } },
        orderBy: { scheduledAt: "asc" },
        take: 1000,
        include: { contact: { select: { name: true, pushName: true, phone: true } } },
      }),
      db.scheduleBlock.findMany({
        where: { startsAt: { lt: fim }, endsAt: { gt: inicio } },
        orderBy: { startsAt: "asc" },
      }),
    ]);

    return {
      agendamentos: agendamentos.map((a) => agendamentoParaTela(a, agora)),
      bloqueios: bloqueios.map((b) => ({ id: b.id, inicio: b.startsAt, fim: b.endsAt, motivo: b.reason })),
    };
  });

  /** Horarios livres de verdade — a tela do CRM oferece os mesmos que a IA. */
  app.get("/api/horarios-livres", async (req) => {
    const { dia, servico, ignorar } = req.query as {
      dia?: string;
      servico?: string;
      ignorar?: string;
    };
    const config = getNegocio();

    const slots = await horariosDisponiveis(config.negocio, {
      duracaoMin: servico ? duracaoDoServico(config, servico) : undefined,
      diaEspecifico: dia,
      ignorarAgendamentoId: ignorar,
      limite: dia ? 40 : 20,
      // Esta lista e da tela do CRM: a equipe encaixa sem antecedencia minima.
      regrasDaIa: false,
    });

    return slots.map((s) => ({
      valor: s.toFormat("yyyy-LL-dd'T'HH:mm"),
      rotulo: formatarSlot(s),
    }));
  });

  /** Agendamento feito na mão: quem ligou no telefone, encaixe na recepção. */
  app.post("/api/agendamentos", async (req, reply) => {
    const corpo = z
      .object({
        telefone: z.string().min(8),
        nome: z.string().optional(),
        servico: z.string().min(1),
        dataHora: z.string().min(1),
        observacao: z.string().optional(),
      })
      .safeParse(req.body);

    if (!corpo.success) {
      return reply.code(400).send({ erro: "Preencha telefone, serviço, data e horário." });
    }

    const config = getNegocio();
    const zona = config.negocio.horarios.timezone;

    // Reaproveita o mesmo caminho de contato/card da conversa: se a pessoa ja
    // falou pelo WhatsApp, o agendamento cai no card dela em vez de criar outro.
    const lead = await garantirLead(corpo.data.telefone, corpo.data.nome ?? null);

    if (corpo.data.nome && !lead.contato.name) {
      await db.contact.update({
        where: { id: lead.contato.id },
        data: { name: corpo.data.nome },
      });
    }

    const resultado = await criarAgendamento(config, {
      contatoId: lead.contato.id,
      negocioId: lead.negocio.id,
      servico: corpo.data.servico,
      quando: DateTime.fromISO(corpo.data.dataHora, { zone: zona }),
      observacao: corpo.data.observacao,
      autor: "humano",
    });

    if (!resultado.ok) return reply.code(409).send({ erro: maiuscula(resultado.motivo) });

    return { ok: true, id: resultado.agendamento.id };
  });

  app.patch("/api/agendamentos/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const corpo = z
      .object({
        status: z.enum(["SCHEDULED", "CONFIRMED", "CANCELED", "DONE", "NOSHOW"]).optional(),
        dataHora: z.string().optional(),
        motivo: z.string().optional(),
      })
      .safeParse(req.body);

    if (!corpo.success) return reply.code(400).send({ erro: "Dados inválidos." });

    const config = getNegocio();

    // Remarcar passa pela mesma validacao da IA (horario livre, antecedencia,
    // bloqueio), e move o lembrete junto.
    if (corpo.data.dataHora) {
      const resultado = await remarcarAgendamento(
        config,
        id,
        DateTime.fromISO(corpo.data.dataHora, { zone: config.negocio.horarios.timezone }),
        "humano",
      );
      if (!resultado.ok) return reply.code(409).send({ erro: maiuscula(resultado.motivo) });
      return { ok: true };
    }

    if (corpo.data.status === "CANCELED") {
      const resultado = await cancelarAgendamento(id, corpo.data.motivo ?? null, "humano");
      if (!resultado.ok) return reply.code(409).send({ erro: maiuscula(resultado.motivo) });
      return { ok: true };
    }

    if (!corpo.data.status) return reply.code(400).send({ erro: "Nada para alterar." });

    const agendamento = await db.appointment.update({
      where: { id },
      data: { status: corpo.data.status },
    });

    // Compareceu ou faltou: o horario ja passou, o lembrete nao faz mais sentido.
    if (corpo.data.status === "DONE" || corpo.data.status === "NOSHOW") {
      await cancelarLembrete(id);
    }

    // O card acompanha a agenda: "compareceu" leva para o estagio aoComparecer.
    await registrarDesfecho(config, id, corpo.data.status, "humano");

    if (agendamento.dealId) {
      await db.dealEvent.create({
        data: {
          dealId: agendamento.dealId,
          type: "appointment",
          body: `${agendamento.service}: ${ROTULO_STATUS[corpo.data.status] ?? corpo.data.status}`,
          author: "humano",
        },
      });
    }

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Bloqueios de agenda
  // -------------------------------------------------------------------------

  app.get("/api/bloqueios", async () => {
    const bloqueios = await db.scheduleBlock.findMany({
      where: { endsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
      take: 100,
    });

    return bloqueios.map((b) => ({
      id: b.id,
      inicio: b.startsAt,
      fim: b.endsAt,
      motivo: b.reason,
    }));
  });

  app.post("/api/bloqueios", async (req, reply) => {
    const corpo = z
      .object({
        inicio: z.string().min(1),
        fim: z.string().min(1),
        motivo: z.string().optional(),
      })
      .safeParse(req.body);

    if (!corpo.success) return reply.code(400).send({ erro: "Informe início e fim do bloqueio." });

    const config = getNegocio();
    const zona = config.negocio.horarios.timezone;
    const inicio = DateTime.fromISO(corpo.data.inicio, { zone: zona });
    const fim = DateTime.fromISO(corpo.data.fim, { zone: zona });

    if (!inicio.isValid || !fim.isValid) {
      return reply.code(400).send({ erro: "Datas inválidas." });
    }
    if (fim <= inicio) {
      return reply.code(400).send({ erro: "O fim do bloqueio precisa ser depois do início." });
    }

    // Avisa (sem impedir) se ja ha gente marcada dentro do periodo: o dono
    // precisa saber que vai ter que remarcar essas pessoas.
    const conflitantes = await db.appointment.count({
      where: {
        status: { in: ["SCHEDULED", "CONFIRMED"] },
        scheduledAt: { gte: inicio.toJSDate(), lt: fim.toJSDate() },
      },
    });

    const bloqueio = await db.scheduleBlock.create({
      data: {
        startsAt: inicio.toJSDate(),
        endsAt: fim.toJSDate(),
        reason: corpo.data.motivo ?? null,
      },
    });

    return { ok: true, id: bloqueio.id, agendamentosNoPeriodo: conflitantes };
  });

  app.delete("/api/bloqueios/:id", async (req) => {
    const { id } = req.params as { id: string };
    await db.scheduleBlock.delete({ where: { id } }).catch(() => {});
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Painel inicial
  // -------------------------------------------------------------------------

  app.get("/api/resumo", async () => {
    const agora = new Date();
    const inicioDoDia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

    const [novosHoje, aguardando, emAtendimentoHumano, agendadosHoje, precisamDeVoce] = await Promise.all([
      db.contact.count({ where: { createdAt: { gte: inicioDoDia } } }),
      db.conversation.count({
        where: {
          mode: "BOT",
          lastInboundAt: { not: null },
          OR: [
            { lastOutboundAt: null },
            { lastOutboundAt: { lt: db.conversation.fields.lastInboundAt } },
          ],
        },
      }),
      db.conversation.count({ where: { mode: "HUMAN" } }),
      db.appointment.count({
        where: {
          scheduledAt: { gte: inicioDoDia, lt: new Date(inicioDoDia.getTime() + 86_400_000) },
          status: { in: ["SCHEDULED", "CONFIRMED"] },
        },
      }),
      db.conversation.count({ where: filtroPrecisaDeVoce(agora) }),
    ]);

    return { novosHoje, aguardando, emAtendimentoHumano, agendadosHoje, precisamDeVoce };
  });
}
