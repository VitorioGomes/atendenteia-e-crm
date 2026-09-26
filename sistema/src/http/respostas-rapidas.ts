import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { normalizarAtalho } from "../lib/atalho.js";
import { exigirLogin } from "./api.js";

/**
 * Respostas rapidas: o texto que a equipe manda dez vezes por dia (endereco, preco,
 * "pode mandar o documento?"), chamado com "/atalho" na caixa de entrada.
 */

const corpo = z.object({
  atalho: z.string().min(1).max(60),
  texto: z.string().trim().min(1).max(4000),
});

const paraTela = (r: { id: string; shortcut: string; text: string }) => ({
  id: r.id,
  atalho: r.shortcut,
  texto: r.text,
});

export async function rotasRespostasRapidas(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", exigirLogin);

  app.get("/api/respostas-rapidas", async () => {
    const lista = await db.quickReply.findMany({ orderBy: { shortcut: "asc" } });
    return lista.map(paraTela);
  });

  const validar = async (dados: unknown, ignorarId?: string) => {
    const lido = corpo.safeParse(dados);
    if (!lido.success) return { erro: "Preencha o atalho e o texto da resposta." } as const;

    const atalho = normalizarAtalho(lido.data.atalho);
    if (!atalho) return { erro: "O atalho precisa ter pelo menos uma letra ou número." } as const;

    const dono = await db.quickReply.findUnique({ where: { shortcut: atalho } });
    if (dono && dono.id !== ignorarId) {
      return { erro: `Já existe uma resposta com o atalho /${atalho}. Escolha outro.` } as const;
    }
    return { atalho, texto: lido.data.texto } as const;
  };

  app.post("/api/respostas-rapidas", async (req, reply) => {
    const v = await validar(req.body);
    if ("erro" in v) return reply.code(400).send({ erro: v.erro });
    const criada = await db.quickReply.create({ data: { shortcut: v.atalho, text: v.texto } });
    return paraTela(criada);
  });

  app.put("/api/respostas-rapidas/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = await validar(req.body, id);
    if ("erro" in v) return reply.code(400).send({ erro: v.erro });
    try {
      const salva = await db.quickReply.update({
        where: { id },
        data: { shortcut: v.atalho, text: v.texto },
      });
      return paraTela(salva);
    } catch {
      return reply.code(404).send({ erro: "Essa resposta não existe mais. Recarregue a página." });
    }
  });

  app.delete("/api/respostas-rapidas/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.quickReply.deleteMany({ where: { id } });
    return reply.code(204).send();
  });
}
