/**
 * Spec 06 — Wallet home (portfolio + address chip)
 *
 * The multi-asset redesign replaced the single-balance hero (USD/BTC
 * value + eye toggle + faucet button) with a per-asset portfolio list
 * and a "Create coin" entry (the testnet faucet is gone — a wallet funds
 * itself by minting its own asset, see `_global-setup.ts`). This spec
 * therefore no longer baselines a balance number; it baselines:
 *   - the funded portfolio (Alice holds ≥1 self-minted asset) on desktop
 *     + mobile,
 *   - the empty-portfolio banner (Bob, zero assets),
 *   - the address-copy chip's "copied" feedback.
 *
 * The funded-vs-empty signal is `asset-list` vs `wallet-empty-banner`
 * (both gated on the first `/api/balance/:address` tick by
 * `waitForBalanceLoaded`). Per-asset balances + ids vary per run and are
 * masked via `asset-row-balance` / `asset-row-id`.
 *
 * DEV-only widgets present in these shots (see README § 8.0): the `Apps`
 * tab in BottomNav (FEATURES.APPS_DIRECTORY). The username-claim row is
 * NOT present — the info-proxy normalises `username_claim` to false.
 */

import { expect, test, type Page } from '@playwright/test';
import { aliceLogin, bobLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

/** Per-asset volatile cells masked in every portfolio golden. The asset
 *  NAME is volatile too — globalSetup mints fixtures with a timestamped
 *  `E2E-<ts>-<rand>` name — so it is masked alongside the balance + id. */
function assetMasks(page: Page) {
  return [
    page.getByTestId('asset-row-name'),
    page.getByTestId('asset-row-balance'),
    page.getByTestId('asset-row-id'),
  ];
}

test.describe('Wallet home', () => {
  test('Visual Regression — balance-funded-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await aliceLogin(page);
    // Funded wallet → the empty banner is absent and the asset list renders.
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('asset-row').first()).toBeVisible({ timeout: 30_000 });
    await snap(page, '06-balance-funded-desktop', { mask: assetMasks(page) });
  });

  test('Visual Regression — balance-funded-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('asset-row').first()).toBeVisible({ timeout: 30_000 });
    await snap(page, '06-balance-funded-mobile', { fullPage: true, mask: assetMasks(page) });
  });

  test('Visual Regression — balance-zero-empty-banner', async ({ page }) => {
    await setViewport(page, 'mobile');
    await bobLogin(page);
    // Bob is never funded — the empty-portfolio banner is the stable anchor.
    await expect(page.getByTestId('wallet-empty-banner')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('asset-list')).toHaveCount(0);
    // The create-coin CTA replaces the old faucet button.
    await expect(page.getByTestId('create-coin-btn')).toBeVisible();
    // fullPage so the empty banner + create-coin CTA are both captured.
    await snap(page, '06-balance-zero-empty-banner', { fullPage: true });
  });

  test('Visual Regression — balance-copied-feedback', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('address-copy-btn').click();
    // The chip flips its check icon + appends a "copied" span for 1.5 s.
    await expect(page.getByTestId('address-copied-feedback')).toBeVisible({ timeout: 2_000 });
    await snap(page, '06-balance-copied-feedback', { fullPage: true, mask: assetMasks(page) });
  });
});
