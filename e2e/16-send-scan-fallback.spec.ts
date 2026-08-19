/**
 * Spec 16 — Send scanner fallback
 *
 * Companion to 15: form/scanner unavailable in this build.
 */

import { expect, test } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { setViewport } from './_helpers/screenshot';

test.describe('Send scan fallback — path not available', () => {
  test('unavailable surface has no scan modal entry', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await page.goto('/send');
    await expect(page.getByTestId('send-unavailable-banner')).toBeVisible();
    await expect(page.getByTestId('qr-scan-modal')).toHaveCount(0);
  });
});
