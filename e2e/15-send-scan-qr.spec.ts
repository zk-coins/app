/**
 * Spec 15 — Send: scan recipient from a QR code (camera leg)
 *
 * Drives the QrScanModal end-to-end in a real Chromium with a FAKE
 * CAMERA: `--use-file-for-fake-video-capture` plays
 * `e2e/_fixtures/qr-scan.y4m` (a single-frame clip of a QR encoding
 * `PAYLOAD`, regenerated via `node scripts/make-qr-y4m.mjs`) into
 * `getUserMedia`, so the full production pipeline — camera stream →
 * canvas sampling → jsQR decode → recipient validation → input fill —
 * runs against a genuine QR image.
 *
 * The scanner-UI + upload-fallback + close affordances live in
 * `16-send-scan-fallback.spec.ts`: they need a camera WITHOUT a QR in
 * view, which is a different Chromium launch configuration, and
 * Playwright only allows `test.use({ launchOptions })` at file scope.
 *
 * Chromium-only: the fake-camera flags are Chromium switches (CI runs
 * `--project=chromium`; the skip guards local cross-browser runs).
 * 1 baseline: 15-scan-filled (taken after the 1.5 s "Address scanned"
 * flash cleared, so the shot is timing-independent).
 *
 * Locators: testid-based throughout.
 */

import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

/** Kept in sync with `PAYLOAD` in scripts/make-qr-y4m.mjs. */
const PAYLOAD = '1a2b3c4d@dev.zkcoins.app';
const Y4M_FIXTURE = join(__dirname, '_fixtures', 'qr-scan.y4m');

test.skip(({ browserName }) => browserName !== 'chromium', 'fake camera is Chromium-only');

// Fake camera that loops the QR clip — the reproducible stand-in for
// holding a phone with a QR code in front of the lens.
test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${Y4M_FIXTURE}`,
    ],
  },
  permissions: ['camera'],
});

/** Alice setup, then Wallet → /send via the in-app Send link. */
async function aliceGoToSend(page: Page): Promise<void> {
  await aliceLogin(page);
  await page.getByTestId('wallet-send-btn').click();
  await expect(page.getByTestId('send-heading')).toBeVisible({ timeout: 10_000 });
}

test.describe('Send — scan QR via fake camera', () => {
  test('scan-camera-fills-recipient', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceGoToSend(page);

    await page.getByTestId('send-scan-qr-btn').click();
    await expect(page.getByTestId('qr-scan-modal')).toBeVisible({ timeout: 10_000 });

    // The fake camera is already playing the QR clip — the scanner
    // decodes it, validates the payload, fills the input, and closes.
    await expect(page.getByTestId('send-recipient-input')).toHaveValue(PAYLOAD, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('qr-scan-modal')).toHaveCount(0);

    // The confirmation flash appears, then clears after 1.5 s — snap the
    // settled state so the baseline is timing-independent.
    await expect(page.getByTestId('send-scan-feedback')).toBeVisible();
    // Neither rejection surface fired along the way.
    await expect(page.getByTestId('qr-scan-invalid')).toHaveCount(0);
    await expect(page.getByTestId('qr-scan-camera-error')).toHaveCount(0);
    await expect(page.getByTestId('send-scan-feedback')).toBeHidden({ timeout: 5_000 });
    await snap(page, '15-scan-filled');
  });
});
