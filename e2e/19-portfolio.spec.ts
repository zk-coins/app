/**
 * Spec 19 — Portfolio surface (honest unavailability)
 *
 * Portfolio reads refuse with 501 until AccountState balances decode ships.
 * The wallet must show `portfolio-unavailable-banner`, never a funded list
 * or a confirmed empty wallet for a failed/unavailable read.
 */

import { expect, test } from '@playwright/test';
import { aliceLogin, bobLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('Portfolio — not available in this build', () => {
  test('Visual Regression — portfolio-unavailable (Alice)', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await expect(page.getByTestId('portfolio-unavailable-banner')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('asset-list')).toHaveCount(0);
    await expect(page.getByTestId('wallet-empty-banner')).toHaveCount(0);
    await snap(page, '19-portfolio-empty', { fullPage: true });
  });

  test('Visual Regression — portfolio-unavailable (Bob)', async ({ page }) => {
    await setViewport(page, 'mobile');
    await bobLogin(page);
    await expect(page.getByTestId('portfolio-unavailable-banner')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('wallet-empty-banner')).toHaveCount(0);
  });

  test('Visual Regression — portfolio-unavailable desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await aliceLogin(page);
    await expect(page.getByTestId('portfolio-unavailable-banner')).toBeVisible({
      timeout: 30_000,
    });
    await snap(page, '19-portfolio-funded-desktop');
  });
});
