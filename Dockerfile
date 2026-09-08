# ── MirzaKateb — single-container production image ──────────
FROM node:20-slim AS base
WORKDIR /app

# ffmpeg stays at runtime (audio conversion + chunking); build tools are removed after install.
COPY server/package*.json ./server/
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && apt-get install -y --no-install-recommends python3 build-essential \
 && cd server && npm ci --omit=dev \
 && apt-get purge -y build-essential python3 && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# App source
COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000

WORKDIR /app/server
CMD ["node", "server.js"]
