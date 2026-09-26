import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

export const db = new PrismaClient({
  log: env.NODE_ENV === "production" ? ["warn", "error"] : ["warn", "error"],
});

export async function fecharDb(): Promise<void> {
  await db.$disconnect();
}
