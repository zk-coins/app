/**
 * Spec 15 — Send QR scan
 *
 * The Send form (and its QR scanner) is not available until input-coin
 * inventory ships. This file only guards that the unavailable surface has
 * no scanner entry points.
 */

import { expect, test } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { setViewport } from './_helpers/screenshot';

test.describe('Send QR scan — path not available', () => {
  test('unavailable surface has no scan control', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await page.goto('/send');
    await expect(page.getByTestId('send-unavailable-banner')).toBeVisible();
    await expect(page.getByTestId('send-scan-btn')).toHaveCount(0);
  });
});
