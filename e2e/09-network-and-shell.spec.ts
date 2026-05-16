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
    // Network badge is rendered on the Settings header — go there.
    await page.getByTestId('nav-settings').click();
    // The badge text is whatever `network` /api/info returned. Assert
    // the badge is visible without pinning the exact label.
    await expect(page.getByTestId('settings-network-badge')).toBeVisible({ timeout: 10_000 });
    await snap(page, '09-network-badge-signet');
  });

  test.fixme('network-badge-loading', async ({ page }) => {
    // Marked fixme — the previous body captured the steady-state badge,
    // not the loading state, because `aliceLogin`'s WalletScreen
    // useEffect already populated `networkName` in the store before
    // the route intercept could fire. The proper body needs to clear
    // the store via `window.__useNetworkStore.setState({ networkName:
    // '' })` after the route intercept is set:
    //
    //   await page.route('**/api/info', async (route) => {
    //     await new Promise((r) => setTimeout(r, 8_000));
    //     await route.continue();
    //   });
    //   await page.evaluate(() => {
    //     (window as any).__useNetworkStore?.setState?.({ networkName: '' });
    //   });
    //   await page.getByTestId('nav-settings').click();
    //   await expect(page.getByTestId('settings-heading')).toBeVisible({ timeout: 10_000 });
    //   await expect(page.getByTestId('settings-network-badge')).toHaveCount(0);
    //   await snap(page, '09-network-badge-loading');
    //
    // The `window.__useNetworkStore` expose ships in this PR
    // (`src/stores/network.ts`) but only takes effect on
    // `dev.zkcoins.app` once this PR has merged to `develop` and the
    // `Deploy DEV` workflow has run. Re-enable the test (drop the
    // `.fixme`) in the follow-up PR after that deploy lands.
    await page.route('**/api/info', async (route) => {
      await new Promise((r) => setTimeout(r, 8_000));
      await route.continue();
    });
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-heading')).toBeVisible({ timeout: 10_000 });
    await snap(page, '09-network-badge-loading');
  });
});
