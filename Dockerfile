FROM node:22-alpine AS base

# Standalone app image. `@zkcoins/sdk` is resolved as a git dependency
# (package.json → git+https://github.com/zk-coins/sdk.git#dbea285e4d23cd393514065ec2f59cfd77595c68;
# flip to the published `@zkcoins/sdk@^0.4.0` once that release ships). No
# sibling sdk/ checkout is required — `npm ci` fetches and `prepare` builds dist/.

FROM base AS deps
RUN apk add --no-cache git
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . ./

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
