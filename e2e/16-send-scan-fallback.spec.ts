/**
 * Spec 16 — Send: scanner modal UI, upload fallback, close
 *
 * Companion to `15-send-scan-qr.spec.ts` (the camera-decode leg). Here
 * Chromium's fake camera runs WITHOUT a capture file, so it streams the
 * synthetic rolling pattern — a live camera that never sees a QR. That
 * keeps the modal open, which is what these tests need:
 *
 *   - scan-modal-open: the scanner overlay reached the scanning state
 *     (starting hint gone, live video up) — the modal's visual baseline.
 *   - scan-upload-fills-recipient: the image-upload fallback decodes
 *     `e2e/_fixtures/qr-scan.png` (same payload as the Y4M, regenerated
 *     via `node scripts/make-qr-y4m.mjs`) and fills the recipient.
 *   - scan-close-keeps-recipient: dismissing the scanner leaves a
 *     hand-typed recipient untouched.
 *
 * Split from spec 15 because the two legs need different Chromium
 * launch args and Playwright only allows `test.use({ launchOptions })`
 * at file scope.
 *
 * Chromium-only. 1 baseline: 16-scan-modal-open (video masked).
 *
 * Locators: testid-based throughout.
 */

import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

/** Kept in sync with `PAYLOAD` in scripts/make-qr-y4m.mjs. */
const PAYLOAD = '1a2b3c4d@dev.zkcoins.app';
const PNG_FIXTURE = join(__dirname, '_fixtures', 'qr-scan.png');

test.skip(({ browserName }) => browserName !== 'chromium', 'fake camera is Chromium-only');

// Fake device WITHOUT a capture file: the camera streams the synthetic
// pattern (never a QR), so the modal stays open for these legs.
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['camera'],
});

/** Alice setup, then Wallet → /send via the in-app Send link. */
async function aliceGoToSend(page: Page): Promise<void> {
  await aliceLogin(page);
  await page.getByTestId('wallet-send-btn').click();
  await expect(page.getByTestId('send-heading')).toBeVisible({ timeout: 10_000 });
}

/** Open the scanner overlay from the Send screen. */
async function openScanner(page: Page): Promise<void> {
  await page.getByTestId('send-scan-qr-btn').click();
  await expect(page.getByTestId('qr-scan-modal')).toBeVisible({ timeout: 10_000 });
}

test.describe('Send — scanner modal and upload fallback', () => {
  test('scan-modal-open', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceGoToSend(page);
    await openScanner(page);

    // Camera reached the scanning state: the starting hint is gone and
    // the live <video> is up. The video content is the synthetic
    // pattern — masked, like every volatile region.
    await expect(page.getByTestId('qr-scan-starting')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('qr-scan-video')).toBeVisible();
    await expect(page.getByTestId('qr-scan-upload-btn')).toBeVisible();
    await snap(page, '16-scan-modal-open', {
      mask: [page.getByTestId('qr-scan-video')],
    });
  });

  test('scan-upload-fills-recipient', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceGoToSend(page);
    await openScanner(page);

    // The visible "Upload image" button proxies a click to this hidden
    // input; setInputFiles drives the input directly because the OS
    // file picker is unreachable from a test.
    await page.getByTestId('qr-scan-file-input').setInputFiles(PNG_FIXTURE);

    await expect(page.getByTestId('send-recipient-input')).toHaveValue(PAYLOAD, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('qr-scan-modal')).toHaveCount(0);
    await expect(page.getByTestId('qr-scan-file-error')).toHaveCount(0);
    await expect(page.getByTestId('send-scan-feedback')).toBeVisible();
  });

  test('scan-close-keeps-recipient', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceGoToSend(page);

    await page.getByTestId('send-recipient-input').fill('bob');
    await openScanner(page);
    await page.getByTestId('qr-scan-close-btn').click();

    await expect(page.getByTestId('qr-scan-modal')).toHaveCount(0);
    await expect(page.getByTestId('send-recipient-input')).toHaveValue('bob');
  });
});
