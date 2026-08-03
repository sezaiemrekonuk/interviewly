# syntax=docker/dockerfile:1
#
# The `api` and `migrate` image (§10.4). Stages: base -> deps -> build / prod-deps -> runner.
#
# Two rules this file exists to enforce, both of which it previously broke:
#
#  1. What tsc resolves and what node resolves must be the same thing. `backend/tsconfig.json`
#     no longer inherits the root `paths`, so `@interviewly/ai` goes through node_modules in
#     the build exactly as it does at runtime, and the emit stays at `backend/dist/src/`.
#  2. Whatever the api imports must be LINKED into the image. `npm ci --workspace=...` links
#     only the workspaces named below — `@interviewly/ai` missing from that list is what made
#     the container die with `ERR_MODULE_NOT_FOUND: /app/packages/ai/src/AiClient`.
#
# `runner` installs with --omit=dev, so no tsx / vitest / cucumber / playwright reaches a
# deployed container. The Prisma CLI is a runtime *dependency* of backend rather than a dev
# one precisely because of that: the compose `migrate` service runs `prisma migrate deploy`
# out of this image.

FROM node:22-alpine AS base
# HUSKY=0 makes the root `prepare` script a no-op. It is not a nicety: husky is a root dev
# dependency, so the --omit=dev install below runs `prepare` with husky already gone and
# npm ci exits 127 (`sh: husky: not found`). There is no git repo in a build stage anyway.
ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    HUSKY=0
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — manifests only, so this layer survives every source-only change.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
# Every workspace manifest must be present or `npm ci` cannot validate the lockfile.
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY worker/package.json worker/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/types/package.json packages/types/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=@interviewly/backend --workspace=@interviewly/ai --include-workspace-root

# ---------------------------------------------------------------------------
# build — compile @interviewly/ai first, then the backend that resolves its .d.ts.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
# Prisma Client is generated code — without this the api/worker/migrate images have an
# empty @prisma/client (F02).
RUN npx prisma generate --schema backend/prisma/schema.prisma
RUN npm run -w @interviewly/ai build \
 && npm run -w @interviewly/backend build
# Fails here rather than in a crash-looping container: this path is the exact thing that
# silently moved when tsc's inferred rootDir last drifted.
RUN test -f backend/dist/src/index.js

# ---------------------------------------------------------------------------
# prod-deps — the same dependency tree with dev dependencies dropped.
# ---------------------------------------------------------------------------
FROM deps AS prod-deps
# `prisma generate` reads the schema; the `migrate` service reads the migrations at runtime.
COPY backend/prisma backend/prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace=@interviewly/backend --workspace=@interviewly/ai --include-workspace-root \
 && npx prisma generate --schema backend/prisma/schema.prisma

# ---------------------------------------------------------------------------
# runner
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
# node_modules (with the @interviewly/* symlinks), the workspace manifests and
# backend/prisma. No application source: everything executed is copied built, below.
COPY --from=prod-deps --chown=node:node /app ./
COPY --from=build --chown=node:node /app/packages/ai/dist packages/ai/dist
COPY --from=build --chown=node:node /app/backend/dist backend/dist
# Read at runtime through `join(__dirname, '..', …)` by packages/ai/src/{registry,config}.ts.
# Same depth from dist/ as from src/, so no path change — but they must be in the image.
COPY --from=build --chown=node:node /app/packages/ai/prompts packages/ai/prompts
COPY --from=build --chown=node:node /app/packages/ai/config packages/ai/config
USER node
EXPOSE 4000
CMD ["node", "backend/dist/src/index.js"]
