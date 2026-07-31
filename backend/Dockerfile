# Multi-stage build: deps -> build -> runner (§10.4).
# Application code lands via the feature ledgers; this stage skeleton is enough
# for `docker compose build` to produce a container the compose healthcheck can reach.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json backend/package.json
RUN npm ci --workspace=@interviewly/backend --include-workspace-root || npm install

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
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
