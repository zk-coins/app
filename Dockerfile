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

# Feature gates — inlined at build time, dead-code-eliminated when "false".
# Code behind a disabled gate is removed from the production bundle, so it
# cannot load, crash, or be exploited at runtime. Default off (fail-closed).
ARG ENABLE_PASSKEY=false
ARG ENABLE_FAUCET=false
ARG ENABLE_USERNAMES=false
ARG ENABLE_APPS_DIRECTORY=false
ARG ENABLE_DEV_ROUTES=false
ARG ENABLE_AUTO_LOCK=false
ARG ENABLE_ADDRESS_ROTATION=false
ARG ENABLE_TOR_ROUTING=false
ENV NEXT_PUBLIC_ENABLE_PASSKEY=$ENABLE_PASSKEY
ENV NEXT_PUBLIC_ENABLE_FAUCET=$ENABLE_FAUCET
ENV NEXT_PUBLIC_ENABLE_USERNAMES=$ENABLE_USERNAMES
ENV NEXT_PUBLIC_ENABLE_APPS_DIRECTORY=$ENABLE_APPS_DIRECTORY
ENV NEXT_PUBLIC_ENABLE_DEV_ROUTES=$ENABLE_DEV_ROUTES
ENV NEXT_PUBLIC_ENABLE_AUTO_LOCK=$ENABLE_AUTO_LOCK
ENV NEXT_PUBLIC_ENABLE_ADDRESS_ROTATION=$ENABLE_ADDRESS_ROTATION
ENV NEXT_PUBLIC_ENABLE_TOR_ROUTING=$ENABLE_TOR_ROUTING

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
