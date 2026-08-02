FROM node:20-alpine AS base

# Build from the monorepo root (parent of app/ and sdk/):
#   docker build -f app/Dockerfile -t zkcoins-app .
# Context includes both app and sdk so `file:../sdk` resolves.

FROM base AS deps
WORKDIR /workspace/app
COPY app/package.json app/package-lock.json ./
COPY sdk /workspace/sdk
RUN npm ci

FROM base AS builder
WORKDIR /workspace/app
COPY --from=deps /workspace/app/node_modules ./node_modules
COPY --from=deps /workspace/sdk /workspace/sdk
COPY app/ ./

# Build-time placeholders — replaced at runtime by entrypoint.sh
ENV NEXT_PUBLIC_API_URL=NEXT_PUBLIC_API_URL_PLACEHOLDER
ENV NEXT_PUBLIC_EXPLORER_URL=NEXT_PUBLIC_EXPLORER_URL_PLACEHOLDER

# Build-time client gates (`NEXT_PUBLIC_ENABLE_*`) are intentionally not
# declared here. Server capabilities come from GET /v1/info at runtime.
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache curl && \
    addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /workspace/app/public ./public
COPY --from=builder --chown=nextjs:nodejs /workspace/app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /workspace/app/.next/static ./.next/static

COPY app/entrypoint.sh /usr/bin/entrypoint.sh
RUN chmod 755 /usr/bin/entrypoint.sh

USER nextjs
EXPOSE 3090
ENV PORT=3090
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "server.js"]
