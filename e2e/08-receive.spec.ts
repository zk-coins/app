/**
 * Spec 08 — Receive Bitcoin (address + QR)
 *
 * Covers § 8.8 of e2e/README.md. The `/receive` screen plus the copy
 * affordance. 4 tests, 4 linux baselines.
 *
 * DEV-only widgets visible in these baselines (per § 8.0 (b)):
 *   - Apps tab in BottomNav (hidden via showNav=false on receive page)
 *   - none of the WalletScreen gated UI — receive page is sparse.
 *
 * Locators: testid-based throughout.
 */

import { expect, test, type Page } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

/** Navigate Wallet → /receive via the in-app Receive link. */
async function goToReceive(page: Page): Promise<void> {
  await page.getByTestId('wallet-receive-btn').click();
  await expect(page.getByTestId('receive-heading')).toBeVisible({ timeout: 10_000 });
}

test.describe('Receive Bitcoin', () => {
  test.beforeEach(async ({ page }) => {
    await aliceLogin(page);
  });

  test('receive-default-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await goToReceive(page);
    await snap(page, '08-receive-default-desktop');
  });

  test('receive-default-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await goToReceive(page);
    await snap(page, '08-receive-default-mobile');
  });

  test('receive-after-copy', async ({ page }) => {
    await setViewport(page, 'mobile');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await goToReceive(page);
    await page.getByTestId('receive-copy-btn').click();
    await expect(page.getByTestId('receive-copy-btn')).toHaveAttribute('data-copied', 'true', {
      timeout: 2_000,
    });
    await snap(page, '08-receive-after-copy');
  });

  test('receive-back-to-wallet', async ({ page }) => {
    await setViewport(page, 'mobile');
    await goToReceive(page);
    await page.getByTestId('receive-back-link').click();
    // The chip is the most reliable marker for WalletScreen.
    await expect(page.locator('text=/[0-9a-f]{8}@zkcoins\\.app/').first()).toBeVisible({
      timeout: 10_000,
    });
    await snap(page, '08-receive-back-to-wallet');
  });
});
