#!/usr/bin/env bash
#
# Assemble handbook screenshots from Playwright chromium-linux visual
# baselines under e2e/*.spec.ts-snapshots/. The flat `<name>.png` output
# layout matches what public/handbook/index.html and public/handbook/de/index.html
# link to (`/handbook/screenshots/<name>.png`).
#
# Usage:
#   scripts/assemble-handbook-screenshots.sh <output-dir>
#
# Used by:
#   - Dockerfile.handbook (multi-stage build → /usr/share/nginx/html/handbook/screenshots/)
#   - local package script `handbook:assemble`
#
# Source of truth for every handbook image is one committed baseline PNG.
# This list is a Docker-build-time equivalent of scripts/sync-handbook-baselines.mjs
# (which serves the same purpose for local `npm run dev` / `npm run build`,
# since public/handbook/screenshots/ is gitignored and not present in a fresh
# checkout). When a new snap() name is added, append a row here AND reference
# it from public/handbook/index.html and public/handbook/de/index.html — never
# source a screenshot from anywhere else.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <output-dir>" >&2
  exit 2
fi

OUT="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$OUT"

# handbook-name → relative path from repo root to the chromium-linux baseline.
# Keep this list in exact sync with every snap(page, name, ...) call in e2e/.
MAPPING=(
  "01-welcome-create-hover=e2e/01-onboarding-welcome.spec.ts-snapshots/01-welcome-create-hover-chromium-linux.png"
  "01-welcome-desktop=e2e/01-onboarding-welcome.spec.ts-snapshots/01-welcome-desktop-chromium-linux.png"
  "01-welcome-mobile=e2e/01-onboarding-welcome.spec.ts-snapshots/01-welcome-mobile-chromium-linux.png"
  "01-welcome-restore-hover=e2e/01-onboarding-welcome.spec.ts-snapshots/01-welcome-restore-hover-chromium-linux.png"
  "01-welcome-tablet=e2e/01-onboarding-welcome.spec.ts-snapshots/01-welcome-tablet-chromium-linux.png"
  "02-password-empty=e2e/02-create-seed.spec.ts-snapshots/02-password-empty-chromium-linux.png"
  "02-password-filled=e2e/02-create-seed.spec.ts-snapshots/02-password-filled-chromium-linux.png"
  "02-password-mismatch=e2e/02-create-seed.spec.ts-snapshots/02-password-mismatch-chromium-linux.png"
  "02-password-too-short=e2e/02-create-seed.spec.ts-snapshots/02-password-too-short-chromium-linux.png"
  "02-seed-acknowledged=e2e/02-create-seed.spec.ts-snapshots/02-seed-acknowledged-chromium-linux.png"
  "02-seed-generating=e2e/02-create-seed.spec.ts-snapshots/02-seed-generating-chromium-linux.png"
  "02-seed-reveal-hidden=e2e/02-create-seed.spec.ts-snapshots/02-seed-reveal-hidden-chromium-linux.png"
  "02-seed-reveal-shown=e2e/02-create-seed.spec.ts-snapshots/02-seed-reveal-shown-chromium-linux.png"
  "02-wallet-after-create=e2e/02-create-seed.spec.ts-snapshots/02-wallet-after-create-chromium-linux.png"
  "03-restore-entry-empty=e2e/03-restore-seed.spec.ts-snapshots/03-restore-entry-empty-chromium-linux.png"
  "03-restore-input-bad-bip39=e2e/03-restore-seed.spec.ts-snapshots/03-restore-input-bad-bip39-chromium-linux.png"
  "03-restore-input-typed-valid=e2e/03-restore-seed.spec.ts-snapshots/03-restore-input-typed-valid-chromium-linux.png"
  "03-restore-input-wrong-count=e2e/03-restore-seed.spec.ts-snapshots/03-restore-input-wrong-count-chromium-linux.png"
  "03-restore-password-empty=e2e/03-restore-seed.spec.ts-snapshots/03-restore-password-empty-chromium-linux.png"
  "03-restore-password-filled=e2e/03-restore-seed.spec.ts-snapshots/03-restore-password-filled-chromium-linux.png"
  "03-restore-password-mismatch=e2e/03-restore-seed.spec.ts-snapshots/03-restore-password-mismatch-chromium-linux.png"
  "03-restore-password-too-short=e2e/03-restore-seed.spec.ts-snapshots/03-restore-password-too-short-chromium-linux.png"
  "03-wallet-after-restore=e2e/03-restore-seed.spec.ts-snapshots/03-wallet-after-restore-chromium-linux.png"
  "04-unlock-empty=e2e/04-unlock-password.spec.ts-snapshots/04-unlock-empty-chromium-linux.png"
  "04-unlock-reset-link=e2e/04-unlock-password.spec.ts-snapshots/04-unlock-reset-link-chromium-linux.png"
  "04-unlock-success-wallet=e2e/04-unlock-password.spec.ts-snapshots/04-unlock-success-wallet-chromium-linux.png"
  "04-unlock-typed=e2e/04-unlock-password.spec.ts-snapshots/04-unlock-typed-chromium-linux.png"
  "04-unlock-wrong-error=e2e/04-unlock-password.spec.ts-snapshots/04-unlock-wrong-error-chromium-linux.png"
  "05-disconnect-cancel-noop=e2e/05-disconnect.spec.ts-snapshots/05-disconnect-cancel-noop-chromium-linux.png"
  "05-disconnect-confirm-dialog=e2e/05-disconnect.spec.ts-snapshots/05-disconnect-confirm-dialog-chromium-linux.png"
  "05-post-disconnect-welcome=e2e/05-disconnect.spec.ts-snapshots/05-post-disconnect-welcome-chromium-linux.png"
  "05-settings-desktop=e2e/05-disconnect.spec.ts-snapshots/05-settings-desktop-chromium-linux.png"
  "05-settings-disconnect-hover=e2e/05-disconnect.spec.ts-snapshots/05-settings-disconnect-hover-chromium-linux.png"
  "05-settings-mobile=e2e/05-disconnect.spec.ts-snapshots/05-settings-mobile-chromium-linux.png"
  "05-wallet-to-settings-nav=e2e/05-disconnect.spec.ts-snapshots/05-wallet-to-settings-nav-chromium-linux.png"
  "06-balance-copied-feedback=e2e/06-balance.spec.ts-snapshots/06-balance-copied-feedback-chromium-linux.png"
  "06-balance-funded-desktop=e2e/06-balance.spec.ts-snapshots/06-balance-funded-desktop-chromium-linux.png"
  "06-balance-funded-mobile=e2e/06-balance.spec.ts-snapshots/06-balance-funded-mobile-chromium-linux.png"
  "06-balance-hidden=e2e/06-balance.spec.ts-snapshots/06-balance-hidden-chromium-linux.png"
  "06-balance-zero-empty-banner=e2e/06-balance.spec.ts-snapshots/06-balance-zero-empty-banner-chromium-linux.png"
  "07-send-unavailable=e2e/07-send.spec.ts-snapshots/07-send-unavailable-chromium-linux.png"
  "08-receive-after-copy=e2e/08-receive.spec.ts-snapshots/08-receive-after-copy-chromium-linux.png"
  "08-receive-back-to-wallet=e2e/08-receive.spec.ts-snapshots/08-receive-back-to-wallet-chromium-linux.png"
  "08-receive-default-desktop=e2e/08-receive.spec.ts-snapshots/08-receive-default-desktop-chromium-linux.png"
  "08-receive-default-mobile=e2e/08-receive.spec.ts-snapshots/08-receive-default-mobile-chromium-linux.png"
  "09-network-info-node=e2e/09-network-and-shell.spec.ts-snapshots/09-network-info-node-chromium-linux.png"
  "09-network-loading=e2e/09-network-and-shell.spec.ts-snapshots/09-network-loading-chromium-linux.png"
  "09-shell-bottomnav-settings-active=e2e/09-network-and-shell.spec.ts-snapshots/09-shell-bottomnav-settings-active-chromium-linux.png"
  "09-shell-bottomnav-wallet-active=e2e/09-network-and-shell.spec.ts-snapshots/09-shell-bottomnav-wallet-active-chromium-linux.png"
  "10-pwa-ios-mode=e2e/10-pwa.spec.ts-snapshots/10-pwa-ios-mode-chromium-linux.png"
  "10-pwa-manual-mode=e2e/10-pwa.spec.ts-snapshots/10-pwa-manual-mode-chromium-linux.png"
  "10-pwa-native-installing=e2e/10-pwa.spec.ts-snapshots/10-pwa-native-installing-chromium-linux.png"
  "10-pwa-native-mode=e2e/10-pwa.spec.ts-snapshots/10-pwa-native-mode-chromium-linux.png"
  "11-receive-no-account-redirect=e2e/11-cross-spec-redirects.spec.ts-snapshots/11-receive-no-account-redirect-chromium-linux.png"
  "11-send-no-account-redirect=e2e/11-cross-spec-redirects.spec.ts-snapshots/11-send-no-account-redirect-chromium-linux.png"
  "11-settings-no-account-redirect=e2e/11-cross-spec-redirects.spec.ts-snapshots/11-settings-no-account-redirect-chromium-linux.png"
  "13-server-error-insufficient-funds=e2e/13-send-server-errors.spec.ts-snapshots/13-server-error-insufficient-funds-chromium-linux.png"
  "13-server-error-prove-failed=e2e/13-send-server-errors.spec.ts-snapshots/13-server-error-prove-failed-chromium-linux.png"
  "13-server-error-unknown-account=e2e/13-send-server-errors.spec.ts-snapshots/13-server-error-unknown-account-chromium-linux.png"
  "14-network-activity-desktop=e2e/14-network-activity.spec.ts-snapshots/14-network-activity-desktop-chromium-linux.png"
  "14-network-activity-mobile=e2e/14-network-activity.spec.ts-snapshots/14-network-activity-mobile-chromium-linux.png"
  "15-scan-filled=e2e/15-send-scan-qr.spec.ts-snapshots/15-scan-filled-chromium-linux.png"
  "16-scan-modal-open=e2e/16-send-scan-fallback.spec.ts-snapshots/16-scan-modal-open-chromium-linux.png"
  "17-tx-detail-desktop=e2e/17-tx-detail.spec.ts-snapshots/17-tx-detail-desktop-chromium-linux.png"
  "17-tx-detail-missing=e2e/17-tx-detail.spec.ts-snapshots/17-tx-detail-missing-chromium-linux.png"
  "17-tx-detail-mobile=e2e/17-tx-detail.spec.ts-snapshots/17-tx-detail-mobile-chromium-linux.png"
  "18-create-empty-desktop=e2e/18-create-coin.spec.ts-snapshots/18-create-empty-desktop-chromium-linux.png"
  "18-create-empty-mobile=e2e/18-create-coin.spec.ts-snapshots/18-create-empty-mobile-chromium-linux.png"
  "18-create-error=e2e/18-create-coin.spec.ts-snapshots/18-create-error-chromium-linux.png"
  "18-create-filled=e2e/18-create-coin.spec.ts-snapshots/18-create-filled-chromium-linux.png"
  "18-create-in-progress=e2e/18-create-coin.spec.ts-snapshots/18-create-in-progress-chromium-linux.png"
  "18-create-success=e2e/18-create-coin.spec.ts-snapshots/18-create-success-chromium-linux.png"
  "19-portfolio-unavailable=e2e/19-portfolio.spec.ts-snapshots/19-portfolio-unavailable-chromium-linux.png"
  "19-portfolio-unavailable-desktop=e2e/19-portfolio.spec.ts-snapshots/19-portfolio-unavailable-desktop-chromium-linux.png"
  "20-send-asset-amount=e2e/20-send-asset.spec.ts-snapshots/20-send-asset-amount-chromium-linux.png"
  "20-send-asset-confirm-desktop=e2e/20-send-asset.spec.ts-snapshots/20-send-asset-confirm-desktop-chromium-linux.png"
  "20-send-asset-confirm-mobile=e2e/20-send-asset.spec.ts-snapshots/20-send-asset-confirm-mobile-chromium-linux.png"
  "20-send-asset-empty=e2e/20-send-asset.spec.ts-snapshots/20-send-asset-empty-chromium-linux.png"
  "20-send-asset-picker=e2e/20-send-asset.spec.ts-snapshots/20-send-asset-picker-chromium-linux.png"
  "21-asset-detail-unavailable=e2e/21-asset-detail.spec.ts-snapshots/21-asset-detail-unavailable-chromium-linux.png"
)

missing=()
copied=0
for entry in "${MAPPING[@]}"; do
  name="${entry%%=*}"
  src_rel="${entry#*=}"
  src="$REPO_ROOT/$src_rel"
  if [ ! -f "$src" ]; then
    missing+=("$name → $src_rel")
    continue
  fi
  cp "$src" "$OUT/$name.png"
  copied=$((copied + 1))
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "error: handbook-screenshot sources missing from e2e snapshots:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo >&2
  echo "Run the visual-regression suite with --update-snapshots and commit" >&2
  echo "baselines, or update the mapping in $0 to point at an existing PNG." >&2
  exit 1
fi

echo "assemble-handbook-screenshots: assembled ${copied} screenshot(s) into ${OUT}"
