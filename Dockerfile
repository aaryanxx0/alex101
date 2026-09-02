FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/bot-worker/package.json ./apps/bot-worker/
COPY packages/shared/package.json ./packages/shared/

# Install ALL dependencies (including dev) — needed for the build step
RUN npm install --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/bot-worker ./apps/bot-worker

# Build TypeScript (typescript lives in devDependencies; that's fine here)
RUN npm run build --workspace @alex101/shared \
 && npm run build --workspace @alex101/bot-worker

# ---- Runtime image ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    BOT_WORKER_HOST=0.0.0.0 \
    BOT_WORKER_PORT=4000 \
    BOT_WORKER_VIEWER_PORT=4001 \
    BOT_WORKER_CONFIG=/data/settings.json

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/bot-worker/package.json ./apps/bot-worker/
COPY packages/shared/package.json ./packages/shared/

# Install ONLY production deps for the runtime image (smaller, no typescript/tsx)
RUN npm install --omit=dev --no-audit --no-fund --workspaces=false \
 && npm install --omit=dev --no-audit --no-fund --workspaces

# Copy compiled output from the builder stage
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/bot-worker/dist ./apps/bot-worker/dist

VOLUME ["/data"]
EXPOSE 4000 4001

ENV PATH=/app/node_modules/.bin:$PATH
CMD ["node", "apps/bot-worker/dist/src/index.js"]