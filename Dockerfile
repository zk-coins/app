FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json yarn.lock ./
COPY apps/wallet/package.json ./apps/wallet/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/zkcoins-wasm/package.json ./packages/zkcoins-wasm/
RUN yarn install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/wallet/node_modules ./apps/wallet/node_modules
COPY . .
RUN cd apps/wallet && npx next build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/wallet/public ./apps/wallet/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/wallet/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/wallet/.next/static ./apps/wallet/.next/static

COPY apps/wallet/entrypoint.sh /usr/bin/entrypoint.sh
RUN chmod 755 /usr/bin/entrypoint.sh

USER nextjs
EXPOSE 3090
ENV PORT=3090
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "apps/wallet/server.js"]
