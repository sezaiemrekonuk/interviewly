# Multi-stage build: deps -> build -> runner (§10.4).
# Application code lands via the feature ledgers; this stage skeleton is enough
# for `docker compose build` to produce a container the compose healthcheck can reach.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Every workspace manifest must be present or `npm ci` cannot validate the lockfile.
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY worker/package.json worker/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/types/package.json packages/types/package.json
# backend's tsconfig compiles packages/ai/src too, so that workspace's deps must install.
RUN npm ci --workspace=@interviewly/backend --workspace=@interviewly/ai --include-workspace-root

FROM node:22-alpine AS build
WORKDIR /app
# Whole tree, not just /app/node_modules: workspaces pinning different versions of a
# dependency get it nested under <workspace>/node_modules instead of hoisted.
COPY --from=deps /app ./
COPY . .
# Prisma Client is generated code — without this the api/worker/migrate images have an
# empty @prisma/client (F02).
RUN npx prisma generate --schema backend/prisma/schema.prisma
RUN npm run -w @interviewly/backend build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app .
USER node
EXPOSE 4000
CMD ["node", "backend/dist/src/index.js"]
