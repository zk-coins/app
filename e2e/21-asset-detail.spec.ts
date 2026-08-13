/**
 * Spec 21 — Asset detail (honest unavailability)
 *
 * Hard-nav after login drops the in-memory account, so the deep-link shows
 * `asset-detail-wallet-unavailable` (not `asset-detail-unavailable`).
 * `asset-detail-missing` implies a confirmed empty hold list and stays hidden.
 */

import { expect, test } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('Asset detail — not available in this build', () => {
  // Hard-nav after login drops the in-memory account → wallet-unavailable.
  // Snapshot name kept for golden continuity.
  test('Visual Regression — asset-detail-unavailable', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await page.goto(`/asset/${'c'.repeat(64)}`);
    await expect(page.getByTestId('asset-detail-wallet-unavailable')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('asset-detail-unavailable')).toHaveCount(0);
    await expect(page.getByTestId('asset-detail-back')).toBeVisible();
    await expect(page.getByTestId('asset-detail-missing')).toHaveCount(0);
    await expect(page.getByTestId('asset-detail-body')).toHaveCount(0);
    await snap(page, '21-asset-detail-unavailable', { fullPage: true });
  });
});
