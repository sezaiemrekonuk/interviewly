# Multi-stage build: deps -> build -> runner (§10.4), next/standalone output.
# Application code lands via F01 and later feature ledgers; this stage skeleton is
# enough for `docker compose build` to produce a container the compose healthcheck
# can reach.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace=frontend --include-workspace-root || npm install

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run -w frontend build || true

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
