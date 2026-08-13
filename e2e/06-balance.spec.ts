/**
 * Spec 06 — Wallet balance / portfolio chrome
 *
 * Portfolio and single-asset balance reads are not available in this build.
 * Login settles on the unavailable banner; empty/funded goldens are wrong
 * until AccountState decode ships.
 */

import { expect, test } from '@playwright/test';
import { aliceLogin, bobLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('View balance — not available in this build', () => {
  test('balance-unavailable-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await aliceLogin(page);
    await expect(page.getByTestId('portfolio-unavailable-banner')).toBeVisible({
      timeout: 30_000,
    });
    // Alice fixtures have no username: claim banner only, no display-name/copy chrome.
    await expect(page.getByTestId('name-claim-unavailable')).toBeVisible();
    await expect(page.getByTestId('account-display-name')).toHaveCount(0);
    await expect(page.getByTestId('address-copy-btn')).toHaveCount(0);
    await expect(page.getByTestId('wallet-empty-banner')).toHaveCount(0);
    await snap(page, '06-balance-funded-desktop');
  });

  test('balance-unavailable-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await expect(page.getByTestId('portfolio-unavailable-banner')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('name-claim-unavailable')).toBeVisible();
    await expect(page.getByTestId('account-display-name')).toHaveCount(0);
    await expect(page.getByTestId('address-copy-btn')).toHaveCount(0);
    await snap(page, '06-balance-funded-mobile');
  });

  test('balance-unavailable for empty fixture too (Bob)', async ({ page }) => {
    await setViewport(page, 'mobile');
    await bobLogin(page);
    await expect(page.getByTestId('portfolio-unavailable-banner')).toBeVisible({
      timeout: 30_000,
    });
    // Must not claim a confirmed empty wallet when the read path is down.
    await expect(page.getByTestId('wallet-empty-banner')).toHaveCount(0);
    await expect(page.getByTestId('name-claim-unavailable')).toBeVisible();
    await expect(page.getByTestId('account-display-name')).toHaveCount(0);
    await expect(page.getByTestId('address-copy-btn')).toHaveCount(0);
    await snap(page, '06-balance-zero-empty-banner', { fullPage: true });
  });
});
