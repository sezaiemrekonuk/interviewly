# Multi-stage build: deps -> build -> runner (§10.4).
# Application code lands via the feature ledgers; this stage skeleton is enough
# for `docker compose build` to produce a container.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY worker/package.json worker/package.json
RUN npm ci --workspace=@interviewly/worker --include-workspace-root || npm install

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run -w @interviewly/worker build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app .
USER node
CMD ["node", "worker/dist/index.js"]
