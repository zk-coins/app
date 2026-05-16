/**
 * Spec 06 — View balance
 *
 * Covers § 8.6 of e2e/README.md. WalletScreen balance area + copy chip
 * + empty-state banner under Alice (funded) and Bob (empty). 4 tests,
 * 4 linux baselines (one mobile).
 *
 * The faucet-button-visible / faucet-minting tests are gone — the
 * faucet is gated behind `FEATURES.FAUCET`, which is off in both DEV
 * and PRD bundles (see issue #30). Faucet UI testing belongs to a
 * local-only setup with `NEXT_PUBLIC_ENABLE_FAUCET=true` in
 * `.env.local`.
 *
 * Locators: testid-based throughout. The funded-vs-empty signal is
 * `wallet-empty-banner` visibility.
 */

import { expect, test } from '@playwright/test';
import { aliceLogin, bobLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('View balance', () => {
  test('balance-funded-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await aliceLogin(page);
    // Wait for the balance polling tick to land; until then the
    // empty-banner could briefly show.
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    await snap(page, '06-balance-funded-desktop');
  });

  test('balance-funded-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    await snap(page, '06-balance-funded-mobile');
  });

  test('balance-hidden', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    await page.getByTestId('balance-toggle-btn').click();
    await expect(page.getByTestId('balance-toggle-btn')).toHaveAttribute('data-hidden', 'true');
    // fullPage so the toggle-icon flip + the now-shown HIDDEN placeholder
    // are both captured (mobile viewport otherwise clips below the chrome).
    await snap(page, '06-balance-hidden', { fullPage: true });
  });

  test('balance-zero-empty-banner', async ({ page }) => {
    await setViewport(page, 'mobile');
    await bobLogin(page);
    await expect(page.getByTestId('wallet-empty-banner')).toBeVisible({ timeout: 30_000 });
    // FEATURES.FAUCET is off in PRD-equivalent DEV — the faucet button
    // is removed from the bundle. Verify the no-funds banner shows up,
    // not the gated button.
    await expect(page.getByTestId('faucet-btn')).toHaveCount(0);
    // fullPage so the empty-banner is captured (sits below the masked
    // balance card and is the entire differentiator vs. funded state).
    await snap(page, '06-balance-zero-empty-banner', { fullPage: true });
  });

  test('balance-copied-feedback', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('address-copy-btn').click();
    await expect(page.getByTestId('address-copied-feedback')).toBeVisible({ timeout: 2_000 });
    // fullPage so the toast/feedback area below the balance card is
    // captured — the differentiator vs. funded-mobile lives there.
    await snap(page, '06-balance-copied-feedback', { fullPage: true });
  });
});
