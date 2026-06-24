# Midas — multi-stage build producing two images from one workspace:
#   target `web`    → nginx serving the built React SPA + reverse-proxying /api
#   target `server` → the Fastify API run with tsx
#
# docker-compose.yml builds both targets; see README for usage.

# ---------- shared dependency install ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
# Copy only manifests first so the install layer caches across source changes.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

# ---------- web production build ----------
FROM deps AS web-build
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter @midas/web build

# ---------- web runtime (nginx) ----------
FROM nginx:1.27-alpine AS web
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1

# ---------- server runtime (tsx) ----------
# @midas/shared is consumed as raw TypeScript, so the server runs under tsx and
# needs no separate compile step — just the shared + server sources.
FROM deps AS server
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
ENV HOST=0.0.0.0 \
    PORT=4000 \
    NODE_ENV=production \
    MIDAS_DATA_PROVIDER=mock
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@midas/server", "start"]
