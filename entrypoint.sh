#!/bin/sh

# Replace build-time placeholders with runtime environment variables.
# This allows the same Docker image to be used in DEV and PRD.
find /app/.next -name '*.js' -exec sed -i'' \
  -e "s|NEXT_PUBLIC_MAINNET_API_URL_PLACEHOLDER|${NEXT_PUBLIC_MAINNET_API_URL}|g" \
  -e "s|NEXT_PUBLIC_TESTNET_API_URL_PLACEHOLDER|${NEXT_PUBLIC_TESTNET_API_URL}|g" \
  -e "s|NEXT_PUBLIC_DEFAULT_NETWORK_PLACEHOLDER|${NEXT_PUBLIC_DEFAULT_NETWORK}|g" \
  -e "s|NEXT_PUBLIC_EXPLORER_URL_PLACEHOLDER|${NEXT_PUBLIC_EXPLORER_URL}|g" \
  {} +

exec "$@"
