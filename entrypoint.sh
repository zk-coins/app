#!/bin/sh

# Replace NEXT_PUBLIC_ environment variables at runtime
# This allows the same Docker image to be used in DEV and PRD
find /app/apps/wallet/.next -name '*.js' -exec sed -i'' \
  -e "s|NEXT_PUBLIC_API_URL|${NEXT_PUBLIC_API_URL}|g" \
  -e "s|NEXT_PUBLIC_EXPLORER_URL|${NEXT_PUBLIC_EXPLORER_URL}|g" \
  -e "s|NEXT_PUBLIC_NETWORK|${NEXT_PUBLIC_NETWORK}|g" \
  {} +

exec "$@"
