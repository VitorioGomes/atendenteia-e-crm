# Build do CRM (front)
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# Build do servidor
FROM node:20-alpine AS server
WORKDIR /app
COPY package.json ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# Imagem final
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# su-exec: a entrada acerta o dono de dados/ e troca para o usuario node (docker/entrada.sh).
RUN apk add --no-cache tini su-exec
COPY --from=server /app/node_modules ./node_modules
COPY --from=server /app/dist ./dist
COPY --from=server /app/prisma ./prisma
COPY --from=server /app/package.json ./
COPY --from=web /web/dist ./web/dist
RUN mkdir -p /app/negocio /app/dados
COPY docker/entrada.sh /app/entrada.sh
RUN chmod +x /app/entrada.sh
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--", "/app/entrada.sh"]
CMD ["npm", "run", "start"]
