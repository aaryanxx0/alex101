FROM node:22-bookworm-slim AS base
ENV NODE_ENV=production \
    BOT_WORKER_HOST=0.0.0.0 \
    BOT_WORKER_PORT=4000 \
    BOT_WORKER_VIEWER_PORT=4001 \
    BOT_WORKER_CONFIG=/data/settings.json

WORKDIR /app

# Copy manifests and install
COPY package.json package-lock.json* ./
COPY apps/bot-worker/package.json ./apps/bot-worker/
COPY packages/shared/package.json ./packages/shared/

RUN npm install --omit=dev --no-audit --no-fund --workspaces=false \
    && npm install --omit=dev --no-audit --no-fund --workspaces

# Build
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/bot-worker ./apps/bot-worker

RUN npm run build --workspace @alex101/shared \
    && npm run build --workspace @alex101/bot-worker

# Persist settings
VOLUME ["/data"]
EXPOSE 4000 4001

ENV PATH=/app/node_modules/.bin:$PATH
CMD ["node", "apps/bot-worker/dist/index.js"]