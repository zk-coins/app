/**
 * Spec 19 — Per-asset portfolio on the wallet home
 *
 * The multi-asset redesign turned the single-balance hero into a
 * portfolio list: one `asset-row` per asset the wallet holds, each
 * linking to `/asset/:id`. This spec baselines the portfolio's render
 * states:
 *
 *   - empty    — Bob holds nothing → `wallet-empty-banner` ("No assets
 *                yet") + the create-coin CTA.
 *   - funded   — Alice holds ≥1 self-minted asset → `asset-list` with
 *                rows (desktop + mobile). Per-asset balance/id vary per
 *                run and are masked.
 *   - loading  — the first `/api/balance/:address` tick is held open;
 *                the portfolio section renders neither the list nor the
 *                empty banner yet (the rest of the chrome is stable).
 *
 * The error path (`/api/balance` 5xx) is intentionally NOT given its own
 * golden: `usePortfolio` swallows a failed fetch, sets `loaded=true` with
 * an empty list, and the UI renders the SAME empty banner as the genuine
 * empty state — a separate baseline would be a pixel-identical duplicate.
 *
 * Wallet home renders inside AppShell with the BottomNav (the `Apps` tab
 * is the DEV-only FEATURES.APPS_DIRECTORY widget, see README § 8.0).
 */

import { expect, test, type Page } from '@playwright/test';
import { aliceLogin, bobLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';
import { multiAssetEnabled } from './_helpers/capabilities';

function assetMasks(page: Page) {
  // The asset NAME is volatile (globalSetup mints `E2E-<ts>-<rand>` fixtures)
  // and must be masked alongside the per-run balance + id.
  return [
    page.getByTestId('asset-row-name'),
    page.getByTestId('asset-row-balance'),
    page.getByTestId('asset-row-id'),
  ];
}

test.describe('Portfolio', () => {
  // Gated on the runtime multi-asset capability: these screens only
  // exist on a `multi_asset:true` node. On the single-asset CI leg
  // (info-proxy forces it false) the whole describe skips; it runs
  // against a true node (local Docker harness).
  test.beforeEach(async () => {
    test.skip(!(await multiAssetEnabled()), 'multi_asset disabled on this node');
  });

  test('Visual Regression — portfolio-empty', async ({ page }) => {
    await setViewport(page, 'mobile');
    await bobLogin(page);
    await expect(page.getByTestId('wallet-empty-banner')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('asset-list')).toHaveCount(0);
    await snap(page, '19-portfolio-empty', { fullPage: true });
  });

  test('Visual Regression — portfolio-funded-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await aliceLogin(page);
    await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('asset-row').first()).toBeVisible({ timeout: 30_000 });
    await snap(page, '19-portfolio-funded-desktop', { mask: assetMasks(page) });
  });

  test('Visual Regression — portfolio-funded-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('asset-row').first()).toBeVisible({ timeout: 30_000 });
    await snap(page, '19-portfolio-funded-mobile', { fullPage: true, mask: assetMasks(page) });
  });

  test('Visual Regression — portfolio-loading', async ({ page }) => {
    await setViewport(page, 'mobile');
    // Log Alice in (first portfolio tick completes), then install a route
    // that holds the NEXT portfolio fetch open and force a WalletScreen
    // RE-MOUNT via client-side navigation (→ /create → Back → /). A hard
    // reload can't be used: it would drop the in-memory account and render
    // the UnlockScreen instead of WalletScreen. On remount `usePortfolio`
    // fires a fresh tick which is now held, so the portfolio section renders
    // neither the list nor the empty banner — the loading frame.
    await aliceLogin(page);
    await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
    await page.context().route(/\/api\/balance\/[^/?]+$/, async (route) => {
      await new Promise((r) => setTimeout(r, 20_000));
      await route.abort();
    });
    await page.getByTestId('create-coin-btn').click();
    await expect(page.getByTestId('create-heading')).toBeVisible({ timeout: 10_000 });
    // Navigate back via the create header's back Link (locale-independent: keyed
    // on its `/` href, not the localized "Back" label) — a client-side nav that
    // re-mounts WalletScreen with the held portfolio tick still in flight.
    await page.locator('header a[href="/"]').first().click();
    // Back on the wallet home: brand + create-coin CTA render immediately;
    // the portfolio body stays blank until the held tick settles.
    await expect(page.getByTestId('create-coin-btn')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('asset-list')).toHaveCount(0);
    await expect(page.getByTestId('wallet-empty-banner')).toHaveCount(0);
    await snap(page, '19-portfolio-loading', { fullPage: true });
  });
});
