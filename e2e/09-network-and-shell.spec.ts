/**
 * Spec 09 — Network badge + AppShell chrome
 *
 * Covers § 8.9 of e2e/README.md. The MVP "Network info badge" function
 * plus the navigation chrome that wraps every other screen (BottomNav
 * tab states, FooterLinks row + grid variants). 6 tests, 6 baselines.
 *
 * DEV mirrors PRD (issue #30) — no Apps tab in BottomNav (gated by
 * FEATURES.APPS_DIRECTORY, off by default), `dev-*` hostnames in the
 * FooterLinks row come from the runtime URL substitution.
 *
 * Locators: testid-based.
 */

import { expect, test } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('Network badge + AppShell', () => {
  test.beforeEach(async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
  });

  test('shell-bottomnav-wallet-active', async ({ page }) => {
    // Default — Alice landed on /, Wallet tab is active. Wait for the
    // balance-poll tick so this captures the funded wallet view rather
    // than the pre-tick empty-banner state (which is visually identical
    // to Bob's empty wallet).
    await expect(page.getByTestId('nav-wallet')).toBeVisible();
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    await snap(page, '09-shell-bottomnav-wallet-active', { fullPage: true });
  });

  test('shell-bottomnav-settings-active', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-heading')).toBeVisible({ timeout: 10_000 });
    // Settings has a `{networkName && …}`-gated badge whose value is
    // populated by WalletScreen's `useEffect(api.info, …)`. Without
    // this wait, the snapshot races the badge render.
    await expect(page.getByTestId('settings-network-badge')).toBeVisible({ timeout: 10_000 });
    await snap(page, '09-shell-bottomnav-settings-active', { fullPage: true });
  });

  test('shell-footerlinks-row', async ({ page }) => {
    // The FooterLinks row variant lives under AppShell on every page.
    // Capture from the wallet (Alice is already there). fullPage so the
    // row at the bottom of the page is actually in the screenshot.
    await expect(page.getByTestId('footer-links-row')).toBeVisible();
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    await snap(page, '09-shell-footerlinks-row', { fullPage: true });
  });

  test('shell-footerlinks-grid', async ({ page }) => {
    // Grid variant is inside Settings § Resources. fullPage snap also
    // captures the network-badge area at the top, so wait for it.
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('footer-links-grid')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('settings-network-badge')).toBeVisible({ timeout: 10_000 });
    await snap(page, '09-shell-footerlinks-grid', { fullPage: true });
  });

  test('network-badge-signet', async ({ page }) => {
    // Network badge is rendered on the Settings header — clip-rect on
    // the badge area so this baseline differentiates from the broader
    // `shell-bottomnav-settings-active` fullPage shot.
    await page.getByTestId('nav-settings').click();
    const badge = page.getByTestId('settings-network-badge');
    await expect(badge).toBeVisible({ timeout: 10_000 });
    const box = await badge.boundingBox();
    if (!box) throw new Error('settings-network-badge bounding box unavailable');
    // Pad ±8 px so anti-aliased borders aren't cropped.
    await snap(page, '09-network-badge-signet', {
      clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 },
    });
  });

  test('network-badge-loading', async ({ page }) => {
    // Clear `networkName` from the zustand store (populated by
    // WalletScreen's `useEffect(api.info)` during `aliceLogin`) so the
    // Settings badge is forced back into its absent-state. With the
    // route intercept below, the re-fetch hangs and the badge never
    // re-appears for the duration of the snap. The store is exposed
    // on `window.__useNetworkStore` for tests — see
    // `src/lib/test-store-expose.ts`.
    //
    // Without this dance, the badge would render its steady-state
    // value on the Settings page (store still populated from login)
    // and `network-badge-loading` would be visually identical to
    // `network-badge-signet` — observed pre-fix on issue #28's PR #33.
    await page.route('**/api/info', async (route) => {
      await new Promise((r) => setTimeout(r, 8_000));
      await route.continue();
    });
    await page.evaluate(() => {
      type StoreShim = { setState?: (s: Record<string, unknown>) => void };
      const w = window as unknown as Record<string, StoreShim | undefined>;
      w.__useNetworkStore?.setState?.({ networkName: '' });
    });
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-heading')).toBeVisible({ timeout: 10_000 });
    // The badge must NOT be visible — that's the whole point of the
    // loading-state baseline. If this assertion fails, the test is
    // not actually capturing a loading state.
    await expect(page.getByTestId('settings-network-badge')).toHaveCount(0);
    // Clip to the page header area so the baseline is focused on the
    // absent-badge region rather than the rest of the settings list.
    const heading = page.getByTestId('settings-heading');
    const box = await heading.boundingBox();
    if (!box) throw new Error('settings-heading bounding box unavailable');
    await snap(page, '09-network-badge-loading', {
      clip: { x: 0, y: 0, width: 375, height: box.y + box.height + 30 },
    });
  });
});
