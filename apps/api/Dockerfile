# syntax=docker/dockerfile:1.7
# Build context: repository root  (docker compose handles this)

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# ---------- build ----------
FROM base AS build
# Manifests first so dependency installs are cached between code changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@gs/api..."
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @gs/api build
# Production-only node_modules for the API (the shared package is bundled into dist).
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm --filter @gs/api deploy --prod /out

# ---------- runtime ----------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health >/dev/null || exit 1
# Apply pending migrations, then start the server.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/server.js"]
