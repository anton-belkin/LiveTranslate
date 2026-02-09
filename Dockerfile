# syntax=docker/dockerfile:1.6
FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

FROM base AS build
COPY . .
RUN pnpm -C packages/shared build \
  && pnpm -C apps/server build \
  && pnpm -C apps/web build

FROM node:20-bookworm-slim AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 8787
CMD ["node","apps/server/src/index.js"]

FROM caddy:2.8-alpine AS web
WORKDIR /srv
COPY --from=build /app/apps/web/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
