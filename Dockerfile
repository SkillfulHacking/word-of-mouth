# syntax=docker/dockerfile:1

# ---- base: Node 24 (glibc, so better-sqlite3's prebuilt binary works) with pnpm from package.json's "packageManager"
FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ---- deps: install with a compiler available in case better-sqlite3 has to build from source
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- circuits: the zero-knowledge circuit files, fetched once and baked in so the door never needs a CDN (~29 MB)
FROM base AS circuits
COPY scripts/fetch-zk.mts ./scripts/fetch-zk.mts
RUN node scripts/fetch-zk.mts 8

# ---- build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=circuits /app/public/zk ./public/zk
# `next build` opens the database while collecting pages; point it somewhere throwaway.
RUN DATABASE_FILE=/tmp/build.db pnpm build

# ---- run: only what the standalone server needs, as a non-root user
FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_FILE=/data/wom.db
LABEL org.opencontainers.image.title="Word of Mouth" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node LICENSE ./LICENSE
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
