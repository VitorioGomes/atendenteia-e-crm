import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { deCsv, paraCsv } from "../lib/csv.js";
import { formatarTelefone, normalizarTelefone, variantesTelefone } from "../lib/telefone.js";
import { lerEtiquetas } from "../lib/estados.js";
import { exigirLogin } from "./api.js";

/**
 * Agenda de contatos.
 *
 * Diferente do funil: aqui esta TODO mundo que ja apareceu, tenha virado
 * oportunidade ou nao. E daqui que sai a lista para levar embora (exportar) —
 * o comprador precisa saber que os contatos sao dele, nao ficam presos.
 *
 * Importar NAO cria card no funil de proposito: subir uma planilha de 800
 * clientes antigos nao pode entupir o kanban com 800 leads falsos. O card nasce
 * quando a pessoa manda mensagem.
 */

const POR_PAGINA = 50;

export async function rotasContatos(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", exigirLogin);

  // -------------------------------------------------------------------------
  // Listar
  // -------------------------------------------------------------------------

  app.get("/api/contatos", async (req) => {
    const { busca, pagina } = req.query as { busca?: string; pagina?: string };
    const paginaAtual = Math.max(1, Number(pagina ?? 1) || 1);
    const termo = (busca ?? "").trim();

    // Busca por nome, e-mail ou telefone. Se parecer telefone, procura pelas
    // duas formas (com e sem o nono digito).
    //
    // Sem `mode: "insensitive"`: o SQLite nao aceita. O LIKE dele ja ignora
    // maiusculas em letras sem acento, entao "maria" acha "Maria". O que ele NAO
    // faz e' ignorar acento — "jose" nao acha "José". Resolver isso exige uma
    // coluna com o nome normalizado, e fica para quando alguem reclamar.
    const filtro = termo
      ? {
          OR: [
            { name: { contains: termo } },
            { pushName: { contains: termo } },
            { email: { contains: termo } },
            ...(/\d/.test(termo)
              ? [{ phone: { in: variantesTelefone(termo) } }, { phone: { contains: termo.replace(/\D/g, "") } }]
              : []),
          ],
        }
      : {};

    const [contatos, total] = await Promise.all([
      db.contact.findMany({
        where: filtro,
        orderBy: { createdAt: "desc" },
        skip: (paginaAtual - 1) * POR_PAGINA,
        take: POR_PAGINA,
        include: {
          deals: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            include: { stage: { select: { name: true } } },
          },
          _count: { select: { appointments: true, conversations: true } },
        },
      }),
      db.contact.count({ where: filtro }),
    ]);

    return {
      total,
      pagina: paginaAtual,
      porPagina: POR_PAGINA,
      contatos: contatos.map((c) => ({
        id: c.id,
        nome: c.name ?? c.pushName,
        telefone: c.phone,
        telefoneFormatado: formatarTelefone(c.phone),
        email: c.email,
        tags: lerEtiquetas(c.tags),
        estagio: c.deals[0]?.stage.name ?? null,
        dealId: c.deals[0]?.id ?? null,
        agendamentos: c._count.appointments,
        conversas: c._count.conversations,
        criadoEm: c.createdAt,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // Criar, editar, apagar
  // -------------------------------------------------------------------------

  app.post("/api/contatos", async (req, reply) => {
    const corpo = z
      .object({
        telefone: z.string().min(8),
        nome: z.string().optional(),
        email: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
      .safeParse(req.body);

    if (!corpo.success) {
      return reply.code(400).send({ erro: "Informe pelo menos um telefone com DDD." });
    }

    const telefone = normalizarTelefone(corpo.data.telefone);
    if (telefone.length < 10) {
      return reply.code(400).send({ erro: "Telefone inválido. Use DDD + número." });
    }

    const jaExiste = await db.contact.findFirst({
      where: { phone: { in: variantesTelefone(telefone) } },
    });
    if (jaExiste) {
      return reply.code(409).send({
        erro: `Esse telefone já está salvo como "${jaExiste.name ?? jaExiste.pushName ?? "sem nome"}".`,
      });
    }

    const contato = await db.contact.create({
      data: {
        phone: telefone,
        name: corpo.data.nome ?? null,
        email: corpo.data.email ?? null,
        tags: corpo.data.tags ?? [],
      },
    });

    return { ok: true, id: contato.id };
  });

  app.patch("/api/contatos/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const corpo = z
      .object({
        nome: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        // Campos coletados pela IA, editados a mao na janela do lead. Vem so o que
        // mudou; texto vazio apaga o campo.
        campos: z.record(z.string(), z.string()).optional(),
      })
      .safeParse(req.body);

    if (!corpo.success) return reply.code(400).send({ erro: "Dados inválidos." });

    let campos: Record<string, unknown> | undefined;
    if (corpo.data.campos) {
      const atual = await db.contact.findUnique({ where: { id }, select: { fields: true } });
      if (!atual) return reply.code(404).send({ erro: "Contato não encontrado." });
      campos = { ...((atual.fields ?? {}) as Record<string, unknown>) };
      for (const [chave, valor] of Object.entries(corpo.data.campos)) {
        if (valor.trim()) campos[chave] = valor.trim();
        else delete campos[chave];
      }
    }

    await db.contact.update({
      where: { id },
      data: {
        name: corpo.data.nome ?? undefined,
        email: corpo.data.email ?? undefined,
        tags: corpo.data.tags ?? undefined,
        fields: campos as Prisma.InputJsonValue | undefined,
      },
    });

    return { ok: true };
  });

  /**
   * Apagar contato apaga TUDO dele: conversas, mensagens, card do funil e
   * agendamentos (cascata do banco). Nao ha lixeira. A tela avisa antes, e o
   * backup diario e a rede de seguranca.
   */
  app.delete("/api/contatos/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const contato = await db.contact.findUnique({
      where: { id },
      include: { _count: { select: { conversations: true, deals: true, appointments: true } } },
    });
    if (!contato) return reply.code(404).send({ erro: "Contato não encontrado." });

    await db.contact.delete({ where: { id } });

    logger.warn(
      { contatoId: id, telefone: contato.phone, apagados: contato._count },
      "contato apagado pelo CRM",
    );

    return { ok: true, apagados: contato._count };
  });

  // -------------------------------------------------------------------------
  // Exportar / importar
  // -------------------------------------------------------------------------

  app.get("/api/contatos/exportar", async (_req, reply) => {
    const contatos = await db.contact.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        deals: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          include: { stage: { select: { name: true } } },
        },
      },
    });

    const csv = paraCsv(
      ["telefone", "nome", "email", "tags", "estagio", "resumo", "criado_em"],
      contatos.map((c) => [
        c.phone,
        c.name ?? c.pushName ?? "",
        c.email ?? "",
        lerEtiquetas(c.tags).join("|"),
        c.deals[0]?.stage.name ?? "",
        c.deals[0]?.summary ?? "",
        c.createdAt.toLocaleDateString("pt-BR"),
      ]),
    );

    const hoje = new Date().toISOString().slice(0, 10);
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="contatos-${hoje}.csv"`)
      .send(csv);
  });

  app.post("/api/contatos/importar", async (req, reply) => {
    const corpo = z.object({ csv: z.string().min(1) }).safeParse(req.body);
    if (!corpo.success) return reply.code(400).send({ erro: "Envie o conteúdo do arquivo." });

    let linhas: Record<string, string>[];
    try {
      linhas = deCsv(corpo.data.csv);
    } catch (e) {
      logger.error({ err: e }, "falha ao ler CSV de importacao");
      return reply.code(400).send({ erro: "Não consegui ler esse arquivo. Ele é um CSV?" });
    }

    if (linhas.length === 0) {
      return reply.code(400).send({ erro: "O arquivo está vazio." });
    }

    // Planilha vinda de outro sistema chama a coluna de "Celular", "WhatsApp",
    // "E-mail"... Ser tolerante aqui evita um monte de importacao frustrada.
    const pegar = (linha: Record<string, string>, ...nomes: string[]): string =>
      nomes.map((n) => linha[n]).find((v) => v && v.trim()) ?? "";

    const COLUNAS_TELEFONE = ["telefone", "celular", "whatsapp", "fone", "numero", "telefone_1"];
    const COLUNAS_NOME = ["nome", "contato", "cliente", "nome_completo", "razao_social"];
    const COLUNAS_EMAIL = ["email", "e_mail", "e_mail_1", "correio"];
    const COLUNAS_TAGS = ["tags", "etiquetas", "marcadores", "categorias"];

    const temColunaTelefone = COLUNAS_TELEFONE.some((c) => c in (linhas[0] ?? {}));
    if (!temColunaTelefone) {
      const encontradas = Object.keys(linhas[0] ?? {}).join(", ");
      return reply.code(400).send({
        erro:
          'O arquivo precisa de uma coluna de telefone (aceito: "telefone", "celular" ou ' +
          `"whatsapp"). Encontrei estas colunas: ${encontradas || "nenhuma"}. ` +
          "Baixe a lista em Exportar para ver o formato certo.",
      });
    }

    let criados = 0;
    let atualizados = 0;
    const problemas: string[] = [];

    for (const [indice, linha] of linhas.entries()) {
      const bruto = pegar(linha, ...COLUNAS_TELEFONE);
      const telefone = normalizarTelefone(bruto);

      if (telefone.length < 10) {
        if (problemas.length < 10) {
          problemas.push(`linha ${indice + 2}: telefone inválido ("${bruto}")`);
        }
        continue;
      }

      const nome = pegar(linha, ...COLUNAS_NOME);
      const email = pegar(linha, ...COLUNAS_EMAIL);
      const tags = pegar(linha, ...COLUNAS_TAGS)
        .split(/[|;,]/)
        .map((t) => t.trim())
        .filter(Boolean);

      try {
        const existente = await db.contact.findFirst({
          where: { phone: { in: variantesTelefone(telefone) } },
        });

        if (existente) {
          await db.contact.update({
            where: { id: existente.id },
            data: {
              // Nao apaga o que ja existe: planilha com celula vazia nao pode
              // limpar o nome que a IA descobriu conversando.
              name: nome || existente.name,
              email: email || existente.email,
              tags: [...new Set([...lerEtiquetas(existente.tags), ...tags])],
            },
          });
          atualizados++;
        } else {
          await db.contact.create({
            data: { phone: telefone, name: nome || null, email: email || null, tags },
          });
          criados++;
        }
      } catch (e) {
        logger.error({ err: e, linha: indice + 2 }, "falha ao importar contato");
        if (problemas.length < 10) problemas.push(`linha ${indice + 2}: erro ao salvar`);
      }
    }

    return { ok: true, criados, atualizados, lidas: linhas.length, problemas };
  });
}
