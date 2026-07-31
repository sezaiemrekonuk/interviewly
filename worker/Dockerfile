# Multi-stage build: deps -> build -> runner (§10.4).
# Application code lands via the feature ledgers; this stage skeleton is enough
# for `docker compose build` to produce a container.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Every workspace manifest must be present or `npm ci` cannot validate the lockfile.
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY worker/package.json worker/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/types/package.json packages/types/package.json
RUN npm ci --workspace=@interviewly/worker --include-workspace-root

FROM node:22-alpine AS build
WORKDIR /app
# Whole tree, not just /app/node_modules: workspaces pinning different versions of a
# dependency get it nested under <workspace>/node_modules instead of hoisted.
COPY --from=deps /app ./
COPY . .
RUN npm run -w @interviewly/worker build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app .
USER node
CMD ["node", "worker/dist/index.js"]
