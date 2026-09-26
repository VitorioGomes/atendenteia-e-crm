import pino from "pino";
import { env } from "../config/env.js";

const desenvolvimento = env.NODE_ENV !== "production";

export const logger = pino({
  level: desenvolvimento ? "debug" : "info",
  transport: desenvolvimento
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
    : undefined,
  // A chave da IA e o token de sessao nunca podem vazar no log.
  redact: {
    paths: ["req.headers.authorization", "req.headers.apikey", "req.headers.cookie", "*.apikey"],
    censor: "***",
  },
});

export type Logger = typeof logger;
