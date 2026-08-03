# syntax=docker/dockerfile:1
#
# The `worker` image (§10.4). Same shape as backend/Dockerfile — see that file for why the
# workspace list and the tsconfig `rootDir` pin are load-bearing rather than cosmetic.
# Nothing under worker/src imports an `@interviewly/*` package today, so only its own
# workspace installs; add the package to BOTH worker/package.json and the `npm ci` lines
# below on the day one does, or the container will die on the first require.

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
    npm ci --workspace=@interviewly/worker --include-workspace-root

FROM deps AS build
COPY . .
RUN npm run -w @interviewly/worker build
RUN test -f worker/dist/index.js

FROM deps AS prod-deps
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace=@interviewly/worker --include-workspace-root

FROM base AS runner
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app ./
COPY --from=build --chown=node:node /app/worker/dist worker/dist
USER node
CMD ["node", "worker/dist/index.js"]
