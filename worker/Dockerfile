# syntax=docker/dockerfile:1
#
# The `worker` image (§10.4). Same shape as backend/Dockerfile — see that file for why the
# workspace list and the tsconfig `rootDir` pin are load-bearing rather than cosmetic.
#
# R01: the report consumer imports `@interviewly/backend` (its compiled `worker-exports`
# barrel) to call `runReport`, which itself imports `@interviewly/ai` — both must be built
# and linked into this image, same two rules as backend/Dockerfile:
#
#  1. What tsc resolves and what node resolves must be the same thing (worker/tsconfig.json's
#     `paths: {}` keeps it on node_modules resolution).
#  2. Whatever the worker imports must be LINKED — `npm ci --workspace=...` links only the
#     workspaces named below.

FROM node:22-alpine AS base
# HUSKY=0: the root `prepare` script would run husky, which the --omit=dev install removes.
ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
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
    npm ci --workspace=@interviewly/worker --workspace=@interviewly/backend --workspace=@interviewly/ai --include-workspace-root

# ---------------------------------------------------------------------------
# build — compile @interviewly/ai, then @interviewly/backend (the barrel worker imports),
# then the worker itself.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
# Prisma Client is generated code — `runReport` (via @interviewly/backend) touches `prisma`.
RUN npx prisma generate --schema backend/prisma/schema.prisma
RUN npm run -w @interviewly/ai build \
 && npm run -w @interviewly/backend build \
 && npm run -w @interviewly/worker build
RUN test -f worker/dist/index.js

FROM deps AS prod-deps
# `prisma generate` reads the schema `@interviewly/backend`'s runtime needs.
COPY backend/prisma backend/prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace=@interviewly/worker --workspace=@interviewly/backend --workspace=@interviewly/ai --include-workspace-root \
 && npx prisma generate --schema backend/prisma/schema.prisma

FROM base AS runner
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app ./
COPY --from=build --chown=node:node /app/packages/ai/dist packages/ai/dist
COPY --from=build --chown=node:node /app/backend/dist backend/dist
# Read at runtime through `join(__dirname, '..', …)` by packages/ai/src/{registry,config}.ts —
# same depth from dist/ as from src/, but they must be in the image.
COPY --from=build --chown=node:node /app/packages/ai/prompts packages/ai/prompts
COPY --from=build --chown=node:node /app/packages/ai/config packages/ai/config
COPY --from=build --chown=node:node /app/worker/dist worker/dist
USER node
CMD ["node", "worker/dist/index.js"]

