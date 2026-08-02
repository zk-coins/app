/**
 * Spec 20 — Multi-asset send (honest unavailability)
 *
 * Same fail-closed Send surface as 07-send: no form, no /v1/tx, unavailable
 * banner only. Funded asset-picker scenarios return with the read path.
 */

import { expect, test } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('Send asset — not available in this build', () => {
  test('Visual Regression — send-asset-unavailable', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await page.goto('/send');
    await expect(page.getByTestId('send-unavailable-banner')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('send-recipient-input')).toHaveCount(0);
    await snap(page, '20-send-asset-empty', { fullPage: true });
  });
});
