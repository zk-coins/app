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

  # Render in English: the committed `*-chromium-linux.png` baselines (and the
  # specs' visible-text assertions) are produced against the hosted DEV stack,
  # which serves English. The app is German-first by default (`i18n/config.ts`),
  # so bake the e2e-only `NEXT_PUBLIC_E2E_LOCALE=en` override to reproduce the
  # baseline locale here. Production builds never set this and stay German.
  echo "▶ [container] next build (NEXT_PUBLIC_API_URL=http://127.0.0.1:${APP_PORT}, proxy→127.0.0.1:${PROXY_PORT}, locale=en)"
  NEXT_PUBLIC_API_URL="http://127.0.0.1:${APP_PORT}" \
  NEXT_PUBLIC_EXPLORER_URL="https://zkcoins.space" \
  NEXT_PUBLIC_E2E_LOCALE="en" \
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
      rm -rf /out/playwright-report /out/test-results /out/snapshots 2>/dev/null || true
      [[ -d playwright-report ]] && cp -a playwright-report /out/playwright-report || true
      [[ -d test-results ]] && cp -a test-results /out/test-results || true
      # Surface any `*-snapshots/` baselines back to the host: the repo is
      # mounted read-only at /src and Playwright runs in the writable /work
      # copy, so `--update-snapshots` writes the regenerated PNGs into
      # /work/e2e/**/*-snapshots/ — which would be lost on container exit. Copy
      # them (preserving the repo-relative path) into /out/snapshots/ so the
      # host entrypoint can sync them into the working tree. Only meaningful on
      # an `--update-snapshots` run; a no-op (harmless) otherwise.
      mkdir -p /out/snapshots
      find e2e -type d -name '*-snapshots' 2>/dev/null | while read -r dir; do
        mkdir -p "/out/snapshots/$(dirname "$dir")"
        cp -a "$dir" "/out/snapshots/$(dirname "$dir")/" 2>/dev/null || true
      done
    fi
  }
  # Set the combined trap BEFORE launching any background process so a
  # failure in the readiness wait can never leak the proxy / app servers.
  trap 'publish_artifacts; cleanup' EXIT

  echo "▶ [container] starting /api/info normalisation proxy :${PROXY_PORT} → ${NODE_URL} (multi_asset=${E2E_MULTI_ASSET:-false})"
  E2E_INFO_PROXY_PORT="$PROXY_PORT" \
  E2E_NODE_URL="$NODE_URL" \
  E2E_INFO_USERNAME_DOMAIN="dev.zkcoins.app" \
  E2E_INFO_MULTI_ASSET="${E2E_MULTI_ASSET:-}" \
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

# The documented usage is `scripts/e2e-local.sh [-- extra playwright args]`.
# Strip a single leading `--` separator so the extra args are forwarded to
# Playwright as flags, not as a literal `--` (a bare `--` makes Playwright
# treat everything after it as test-file path filters → "No tests found").
# `npm run test:e2e:local -- --update-snapshots` already strips the npm `--`,
# but a direct `scripts/e2e-local.sh -- --update-snapshots` invocation does
# not, so normalise it here.
if [[ "${1:-}" == "--" ]]; then
  shift
fi

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

# Note: not `exec` — we need a post-run step to sync regenerated baselines
# back into the working tree (the container can't write the read-only /src
# mount, so it stages them under /out/snapshots/ instead). `set +e` around
# the run so a non-zero exit (e.g. a few specs failing on an
# `--update-snapshots` regen) does NOT abort before that sync step — the
# whole point of a regen run is to surface the baselines it produced.
set +e
docker run --rm -i \
  --add-host=host.docker.internal:host-gateway \
  -v "${REPO_ROOT}:/src:ro" \
  -v "${OUT_DIR}:/out" \
  -e E2E_NODE_URL="${NODE_URL}" \
  -e E2E_LOCAL_APP_PORT="${E2E_LOCAL_APP_PORT:-3090}" \
  -e E2E_INFO_PROXY_PORT="${E2E_INFO_PROXY_PORT:-4243}" \
  -e E2E_NETWORK_EXPECTED="${E2E_NETWORK_EXPECTED:-signet}" \
  -e E2E_FAUCET_CALLS="${E2E_FAUCET_CALLS:-1}" \
  -e E2E_MULTI_ASSET="${E2E_MULTI_ASSET:-}" \
  -e CI="${CI:-}" \
  "${IMAGE}" \
  bash /src/scripts/e2e-local.sh __in_container "$@"
DOCKER_EXIT=$?
set -e

# On an `--update-snapshots` run, sync the regenerated baselines the container
# staged under /out/snapshots/ back into the working tree. The container runs
# in a /src copy, so this is the only path by which new/changed
# `*-chromium-linux.png` goldens reach the repo. Gated on the flag so a plain
# verification run never mutates committed baselines.
case " $* " in
  *--update-snapshots*|*" -u "*)
    if [[ -d "${OUT_DIR}/snapshots/e2e" ]]; then
      echo "▶ [host] syncing regenerated baselines → ${REPO_ROOT}/e2e"
      cp -a "${OUT_DIR}/snapshots/e2e/." "${REPO_ROOT}/e2e/"
    fi
    ;;
esac

exit "$DOCKER_EXIT"
