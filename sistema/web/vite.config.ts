import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],

  resolve: {
    // Fora do modo demonstracao, "./demo" vira um arquivo vazio: os dados
    // ficticios de clinica nao entram no sistema que o comprador instala.
    alias:
      mode === "demo"
        ? []
        : [
            {
              find: /^\.\/demo$/,
              replacement: fileURLToPath(new URL("./src/demo-vazio.ts", import.meta.url)),
            },
          ],
  },

  build: {
    outDir: "dist",
    // O CRM roda numa VPS pequena; nao vale carregar mapa de codigo em producao.
    sourcemap: false,
  },

  server: {
    // Em desenvolvimento o front roda separado e conversa com o servidor na 3000.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
}));
