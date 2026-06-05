#!/usr/bin/env bash
#
# One-command local E2E run: the SAME Playwright specs + the SAME
# `*-chromium-linux.png` baselines that CI runs against the hosted DEV
# stack, but pointed at a locally-served standalone PR build + a local
# zkCoins node. Idempotent and self-cleaning.
#
# ── WHY A LINUX CONTAINER ─────────────────────────────────────────────
# The committed visual baselines are `*-chromium-linux.png` — they were
# rendered on Linux. A native macOS Chromium produces sub-pixel-different
# glyphs and fails the diff, so the visual leg MUST run inside a Linux
# Playwright image pinned to the EXACT `@playwright/test` version
# (mcr.microsoft.com/playwright:v<ver>-noble). This script derives the
# tag from the installed package so the two can never drift.
#
# ── WHAT IT DOES (all inside the one container) ───────────────────────
#   1. npm ci
#   2. next build with the same-origin proxy config baked in:
#        NEXT_PUBLIC_API_URL=http://127.0.0.1:<APP_PORT>   (browser → own origin)
#        LOCAL_NODE_PROXY_TARGET=http://127.0.0.1:<PROXY_PORT> (Next rewrite → proxy)
#   3. start the test-only /api/info capability-normalisation proxy
#      (scripts/e2e-info-proxy.mjs) → upstream local node
#   4. start the Next standalone server (node .next/standalone/server.js)
#   5. Playwright, two legs:
#        leg 1: --grep-invert "send-success" (parallel, fixtures minted once)
#        leg 2: --grep "send-success" --workers=1 (ONE real send via the node)
#   6. tear everything down
#
# ── TOPOLOGY ──────────────────────────────────────────────────────────
#   browser ─(same-origin /api/*)→ Next standalone ─(rewrite)→ proxy ─→ node
#   e2e helpers (Node, E2E_API_URL) ─────────────────────────────────→ proxy ─→ node
#   Both observe the DEV-normalised /api/info; everything else hits the node 1:1.
#
# ── CONFIG (env overrides) ────────────────────────────────────────────
#   E2E_NODE_URL        upstream node, as seen FROM the container
#                       (default http://host.docker.internal:4242)
#   E2E_LOCAL_APP_PORT  standalone app port inside container (default 3090)
#   E2E_INFO_PROXY_PORT info-proxy port inside container     (default 4243)
#   E2E_NETWORK_EXPECTED network badge label                 (default signet)
#   E2E_FAUCET_CALLS    mint cycles to seed Alice            (default 1)
#
# Usage:  npm run test:e2e:local     (or)   scripts/e2e-local.sh [-- extra playwright args]
#
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# IN-CONTAINER ENTRYPOINT
# When invoked with the internal flag we are already inside the Playwright
# Linux image. Build, serve, and run the two-leg suite here.
# ──────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "__in_container" ]]; then
  shift
  APP_PORT="${E2E_LOCAL_APP_PORT:-3090}"
  PROXY_PORT="${E2E_INFO_PROXY_PORT:-4243}"
  NODE_URL="${E2E_NODE_URL:-http://host.docker.internal:4242}"

  # The repo is mounted READ-ONLY at /src. Copy it to a writable,
  # container-internal workdir so `npm ci` (Linux binaries) + `next build`
  # never touch the host's macOS node_modules / .next. Exclude the host's
  # node_modules + .next from the copy — we install fresh Linux deps.
  echo "▶ [container] staging repo /src → /work (fresh Linux deps)"
  mkdir -p /work
  cp -a /src/. /work/
  rm -rf /work/node_modules /work/.next
  cd /work

  echo "▶ [container] npm ci"
  npm ci

  echo "▶ [container] next build (NEXT_PUBLIC_API_URL=http://127.0.0.1:${APP_PORT}, proxy→127.0.0.1:${PROXY_PORT})"
  NEXT_PUBLIC_API_URL="http://127.0.0.1:${APP_PORT}" \
  NEXT_PUBLIC_EXPLORER_URL="https://zkcoins.space" \
  LOCAL_NODE_PROXY_TARGET="http://127.0.0.1:${PROXY_PORT}" \
    npm run build

  # `next build` with output:standalone emits a minimal server tree but
  # does NOT copy `public/` or `.next/static` into it (the Dockerfile does
  # this manually). Mirror that here so the standalone server can serve
  # assets + the static chunks.
  echo "▶ [container] assembling standalone tree"
  cp -r public .next/standalone/public
  mkdir -p .next/standalone/.next
  cp -r .next/static .next/standalone/.next/static

  INFO_PROXY_PID=""
  APP_PID=""
  cleanup() {
    echo "▶ [container] cleanup"
    [[ -n "$APP_PID" ]] && kill "$APP_PID" 2>/dev/null || true
    [[ -n "$INFO_PROXY_PID" ]] && kill "$INFO_PROXY_PID" 2>/dev/null || true
  }
  # Surface the HTML report + any failure artifacts back to the host (if a
  # writable /out is bound) regardless of pass/fail, so a red run is
  # debuggable from outside the container.
  publish_artifacts() {
    if [[ -d /out ]]; then
      rm -rf /out/playwright-report /out/test-results 2>/dev/null || true
      [[ -d playwright-report ]] && cp -a playwright-report /out/playwright-report || true
      [[ -d test-results ]] && cp -a test-results /out/test-results || true
    fi
  }
  # Set the combined trap BEFORE launching any background process so a
  # failure in the readiness wait can never leak the proxy / app servers.
  trap 'publish_artifacts; cleanup' EXIT

  echo "▶ [container] starting /api/info normalisation proxy :${PROXY_PORT} → ${NODE_URL}"
  E2E_INFO_PROXY_PORT="$PROXY_PORT" \
  E2E_NODE_URL="$NODE_URL" \
  E2E_INFO_USERNAME_DOMAIN="dev.zkcoins.app" \
    node scripts/e2e-info-proxy.mjs &
  INFO_PROXY_PID=$!

  echo "▶ [container] starting Next standalone server :${APP_PORT}"
  PORT="$APP_PORT" HOSTNAME="127.0.0.1" node .next/standalone/server.js &
  APP_PID=$!

  # Wait for both to answer before handing off to Playwright.
  echo "▶ [container] waiting for proxy + app to come up"
  for i in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${PROXY_PORT}/api/info" >/dev/null 2>&1 &&
      curl -sf "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
      break
    fi
    if [[ "$i" == "60" ]]; then
      echo "✗ proxy or app did not come up within 60s" >&2
      curl -s "http://127.0.0.1:${PROXY_PORT}/api/info" || true
      exit 1
    fi
    sleep 1
  done

  # Sanity: the proxy must report the DEV surface (caps OFF). A mismatch
  # here would silently break ~16 baselines, so fail loud instead.
  PROXY_INFO="$(curl -s "http://127.0.0.1:${PROXY_PORT}/api/info")"
  echo "▶ [container] proxied /api/info → ${PROXY_INFO}"
  case "$PROXY_INFO" in
    *'"username_claim":true'*)
      echo "✗ proxy did not normalise username_claim to false — baselines would break" >&2
      exit 1
      ;;
  esac

  export E2E_TARGET="local"
  export E2E_BASE_URL="http://127.0.0.1:${APP_PORT}"
  export E2E_API_URL="http://127.0.0.1:${PROXY_PORT}"
  export E2E_LOCAL_APP_PORT="$APP_PORT"
  export E2E_NETWORK_EXPECTED="${E2E_NETWORK_EXPECTED:-signet}"
  export E2E_FAUCET_CALLS="${E2E_FAUCET_CALLS:-1}"
  export E2E_NEED_FIXTURES="true"

  echo "▶ [container] E2E leg 1 — parallel suite (excluding send-success)"
  npx playwright test --project=chromium --grep-invert "send-success" "$@"

  echo "▶ [container] E2E leg 2 — send-success (one real send, workers=1)"
  npx playwright test --project=chromium --grep "send-success" --workers=1 "$@"

  echo "✓ [container] local E2E suite complete"
  exit 0
fi

# ──────────────────────────────────────────────────────────────────────
# HOST ENTRYPOINT
# Resolve the Playwright image tag from the installed package, then run
# the in-container entrypoint with the repo mounted.
# ──────────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "✗ docker is required for the visual leg (the baselines are *-chromium-linux.png)." >&2
  echo "  Native macOS Playwright runs functionally only — see e2e/README.md § 4.2." >&2
  exit 1
fi

PW_VERSION="$(node -e "console.log(require('@playwright/test/package.json').version)")"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
NODE_URL="${E2E_NODE_URL:-http://host.docker.internal:4242}"

echo "▶ [host] Playwright image: ${IMAGE}"
echo "▶ [host] upstream node (from container): ${NODE_URL}"

# The repo is mounted READ-ONLY at /src; the container copies it to an
# internal /work and runs a fresh Linux `npm ci` there, so the host's
# macOS node_modules / .next are never touched. `/out` is a writable bind
# for the HTML report + failure artifacts. `--add-host` wires
# host.docker.internal on Linux daemons; harmless on Docker Desktop /
# OrbStack where it already resolves.
OUT_DIR="${REPO_ROOT}/playwright-report-local"
mkdir -p "${OUT_DIR}"
echo "▶ [host] report + artifacts → ${OUT_DIR}"

exec docker run --rm -i \
  --add-host=host.docker.internal:host-gateway \
  -v "${REPO_ROOT}:/src:ro" \
  -v "${OUT_DIR}:/out" \
  -e E2E_NODE_URL="${NODE_URL}" \
  -e E2E_LOCAL_APP_PORT="${E2E_LOCAL_APP_PORT:-3090}" \
  -e E2E_INFO_PROXY_PORT="${E2E_INFO_PROXY_PORT:-4243}" \
  -e E2E_NETWORK_EXPECTED="${E2E_NETWORK_EXPECTED:-signet}" \
  -e E2E_FAUCET_CALLS="${E2E_FAUCET_CALLS:-1}" \
  -e CI="${CI:-}" \
  "${IMAGE}" \
  bash /src/scripts/e2e-local.sh __in_container "$@"
