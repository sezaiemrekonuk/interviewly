# syntax=docker/dockerfile:1
#
# The `web` image (§10.4), on Next's `output: "standalone"` (frontend/next.config.ts).
# Next traces the monorepo, so the standalone bundle carries its own pruned node_modules and
# lands the entry point at `<standalone>/frontend/server.js` — hence the CMD path and the
# separate `static` / `public` copies, neither of which the tracer includes.

FROM node:22-alpine AS base
ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NEXT_TELEMETRY_DISABLED=1 \
    HUSKY=0
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
# Every workspace manifest must be present or `npm ci` cannot validate the lockfile.
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY worker/package.json worker/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/types/package.json packages/types/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=frontend --include-workspace-root

FROM deps AS build
COPY . .
ENV NODE_ENV=production
RUN npm run -w frontend build
RUN test -f frontend/.next/standalone/frontend/server.js

# No --omit=dev stage here: the standalone output already contains exactly the runtime
# modules the tracer found, so the runner installs nothing at all.
FROM base AS runner
# HOSTNAME baked in rather than left to compose: Next's standalone server binds localhost by
# default, which no healthcheck or reverse proxy outside the container can reach.
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static ./frontend/.next/static
COPY --from=build --chown=node:node /app/frontend/public ./frontend/public
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
