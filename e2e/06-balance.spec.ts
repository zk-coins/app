/**
 * Spec 06 — View balance
 *
 * Covers § 8.6 of e2e/README.md. WalletScreen balance area + copy chip
 * + faucet banner under Alice (funded) and Bob (empty). 6 tests, 6
 * linux baselines (one mobile).
 *
 * DEV-only widgets visible in these baselines (per § 8.0 (b)):
 *   - Apps tab in BottomNav (FEATURES.APPS_DIRECTORY)
 *   - Username claim input on the wallet (FEATURES.USERNAMES) — for
 *     Alice + Bob, both unclaimed
 *   - Faucet button on the empty-balance banner (Bob screenshots)
 *   - `dev-*` hostnames in the FooterLinks row
 *
 * Locators: testid-based throughout. The funded-vs-empty signal is
 * `wallet-empty-banner` visibility; faucet minting state is detected
 * via the `data-minting` attribute on the faucet button so the
 * "Minting…" baseline doesn't depend on the literal text.
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
    await setViewport(page, 'desktop');
    await aliceLogin(page);
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    await page.getByTestId('balance-toggle-btn').click();
    // Hidden state shows the "••••" placeholder — the default mask
    // covers the balance-value testid wrapper, so this baseline
    // captures the surrounding chrome change (icon, BTC line, layout).
    // Assert the hidden flag flipped via `data-hidden`, which is the
    // i18n-stable replacement for the previous `aria-label='Show balance'`
    // role-based check.
    await expect(page.getByTestId('balance-toggle-btn')).toHaveAttribute('data-hidden', 'true');
    await snap(page, '06-balance-hidden');
  });

  test('balance-zero-faucet-visible', async ({ page }) => {
    await setViewport(page, 'desktop');
    await bobLogin(page);
    await expect(page.getByTestId('wallet-empty-banner')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('faucet-btn')).toBeVisible({ timeout: 30_000 });
    await snap(page, '06-balance-zero-faucet-visible');
  });

  test('balance-faucet-minting', async ({ page }) => {
    await setViewport(page, 'desktop');
    // Intercept /api/mint so the round-trip stalls and the "Minting…"
    // disabled-button state has time to render.
    await page.route('**/api/mint', async (route) => {
      await new Promise((r) => setTimeout(r, 2_500));
      await route.continue();
    });
    await bobLogin(page);
    await expect(page.getByTestId('faucet-btn')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('faucet-btn').click();
    await expect(page.getByTestId('faucet-btn')).toHaveAttribute('data-minting', 'true', {
      timeout: 5_000,
    });
    await snap(page, '06-balance-faucet-minting');
  });

  test('balance-copied-feedback', async ({ page }) => {
    await setViewport(page, 'desktop');
    await aliceLogin(page);
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    // Grant clipboard permission so navigator.clipboard.writeText
    // resolves rather than rejecting under Playwright's default deny.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    // Click the address chip button. After click: `copied` state turns
    // the chip's icon into Check + appends a localisable "copied" hint
    // for 1.5 s.
    await page.getByTestId('address-copy-btn').click();
    await expect(page.getByTestId('address-copied-feedback')).toBeVisible({ timeout: 2_000 });
    await snap(page, '06-balance-copied-feedback');
  });
});
