FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/zkcoins-wasm/package.json ./packages/zkcoins-wasm/
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time placeholders — replaced at runtime by entrypoint.sh
ENV NEXT_PUBLIC_API_URL=NEXT_PUBLIC_API_URL_PLACEHOLDER
ENV NEXT_PUBLIC_EXPLORER_URL=NEXT_PUBLIC_EXPLORER_URL_PLACEHOLDER

# Build-time client gates (`NEXT_PUBLIC_ENABLE_*`) are intentionally not
# declared here. They are a local-developer convenience read from
# `.env.local` to preview work-in-progress UI; the deployed image must
# not ship any gated branch. Without an ENV in this stage,
# `process.env.NEXT_PUBLIC_ENABLE_*` is undefined at build time, every
# `FEATURES.X` resolves to `false`, and Next.js DCE strips the gated
# branches from the bundle. When a feature is ready to ship, the gate
# is dropped from the code — never enabled via env var.
#
# Server-side feature gates (`FAUCET`, `USERNAMES`) are NOT build-time
# anymore. They are reported by the server at `/api/info.capabilities`
# and consumed via `useFeatures()` at runtime, so this image runs the
# same code regardless of which Cargo features the server was compiled
# with. The server is the single source of truth.
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache curl && \
    addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

COPY entrypoint.sh /usr/bin/entrypoint.sh
RUN chmod 755 /usr/bin/entrypoint.sh

USER nextjs
EXPOSE 3090
ENV PORT=3090
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "server.js"]
