/**
 * Spec 21 — Asset detail (honest unavailability)
 *
 * Without a successful portfolio read, deep-links must show
 * `asset-detail-unavailable`, never `asset-detail-missing` (which implies
 * a confirmed empty hold list).
 */

import { expect, test } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('Asset detail — not available in this build', () => {
  test('Visual Regression — asset-detail-unavailable', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await page.goto(`/asset/${'c'.repeat(64)}`);
    await expect(page.getByTestId('asset-detail-unavailable')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('asset-detail-back')).toBeVisible();
    await expect(page.getByTestId('asset-detail-missing')).toHaveCount(0);
    await expect(page.getByTestId('asset-detail-body')).toHaveCount(0);
    await snap(page, '21-asset-detail-unavailable', { fullPage: true });
  });
});
