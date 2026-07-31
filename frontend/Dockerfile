# Multi-stage build: deps -> build -> runner (§10.4), next/standalone output.
# Application code lands via F01 and later feature ledgers; this stage skeleton is
# enough for `docker compose build` to produce a container the compose healthcheck
# can reach.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Every workspace manifest must be present or `npm ci` cannot validate the lockfile.
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY worker/package.json worker/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/types/package.json packages/types/package.json
RUN npm ci --workspace=frontend --include-workspace-root

FROM node:22-alpine AS build
WORKDIR /app
# Whole tree, not just /app/node_modules: workspaces pinning different versions of a
# dependency get it nested under <workspace>/node_modules instead of hoisted.
COPY --from=deps /app ./
COPY . .
RUN npm run -w frontend build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
