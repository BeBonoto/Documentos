# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# poppler-utils: pdftoppm para OCR de PDFs escaneados.
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY db ./db

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Aplica migrations pendentes e sobe o bot.
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/index.js"]
