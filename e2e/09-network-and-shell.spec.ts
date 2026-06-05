/**
 * Spec 09 — Network info + AppShell chrome
 *
 * Covers § 8.9 of e2e/README.md. The MVP "network info" surface — the
 * connected node host shown in the Settings About card — plus the
 * navigation chrome that wraps every other screen (BottomNav tab
 * states, FooterLinks row + grid variants). 6 tests, 6 baselines.
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

test.describe('Network info + AppShell', () => {
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
    // Wait for the About card's node-host row before snapping so the
    // settings page is fully laid out.
    await expect(page.getByTestId('settings-node-host')).toBeVisible({ timeout: 10_000 });
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
    // captures the About card at the top, so wait for it.
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('footer-links-grid')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('settings-node-host')).toBeVisible({ timeout: 10_000 });
    await snap(page, '09-shell-footerlinks-grid', { fullPage: true });
  });

  test('network-info-node', async ({ page }) => {
    // The connected node host lives in the Settings About card — go there.
    await page.getByTestId('nav-settings').click();
    // The node host is the configured apiUrl with the scheme stripped;
    // assert it is visible without pinning the exact host.
    await expect(page.getByTestId('settings-node-host')).toBeVisible({ timeout: 10_000 });
    await snap(page, '09-network-info-node');
  });

  test('network-loading', async ({ page }) => {
    // Capture the network-not-loaded state on Settings.
    //
    // `aliceLogin` mounts WalletScreen, whose `useEffect(api.info, …)`
    // fires immediately and populates `networkName` in the store.
    // Wait for that first roundtrip to settle BEFORE installing the
    // route block — otherwise the in-flight response sneaks past the
    // intercept and writes `networkName` back to its real value as
    // soon as Settings has rendered, re-introducing the Network row
    // and turning the loading baseline into a flake.
    type StoreShim = {
      getState: () => { networkName: string };
      setState: (s: Record<string, unknown>) => void;
    };
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const w = window as unknown as { __useNetworkStore?: StoreShim };
            return w.__useNetworkStore?.getState().networkName ?? '';
          }),
        { timeout: 10_000 },
      )
      .not.toBe('');

    // Block any further /api/info call from racing past us. The store
    // is exposed on `window.__useNetworkStore` in `src/stores/network.ts`
    // for this purpose.
    await page.route('**/api/info', async (route) => {
      await new Promise((r) => setTimeout(r, 8_000));
      await route.continue();
    });
    await page.evaluate(() => {
      const w = window as unknown as { __useNetworkStore?: StoreShim };
      w.__useNetworkStore?.setState({ networkName: '' });
    });
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-heading')).toBeVisible({ timeout: 10_000 });
    // The About "Network" row is `{networkName && …}`-gated, so with an
    // empty networkName it is absent while the always-present node host
    // still renders. This baseline captures that network-not-loaded view.
    await expect(page.getByTestId('settings-node-host')).toBeVisible({ timeout: 10_000 });
    await snap(page, '09-network-loading');
  });
});
