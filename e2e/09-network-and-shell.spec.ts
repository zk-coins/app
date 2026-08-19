/**
 * Spec 09 — Network info + AppShell chrome
 *
 * Covers § 8.9 of e2e/README.md. The default-active "network info" surface — the
 * connected node host shown in the Settings About card — plus the
 * navigation chrome that wraps every other screen (BottomNav tab
 * states). 4 tests, 4 baselines.
 *
 * DEV mirrors PRD (issue #30) — no Apps tab in BottomNav (gated by
 * FEATURES.APPS_DIRECTORY, off by default).
 *
 * Locators: testid-based.
 */

import { expect, test } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('Network info + AppShell', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000);
    await setViewport(page, 'mobile');
    await aliceLogin(page);
  });

  test('shell-bottomnav-wallet-active', async ({ page }) => {
    // Default — Alice landed on /, Wallet tab is active. Wait for the
    // balance-poll tick so this captures the funded wallet view rather
    // than the pre-tick empty-banner state (which is visually identical
    // to Bob's empty wallet).
    await expect(page.getByTestId('nav-wallet')).toBeVisible();
    await expect(page.getByTestId('portfolio-unavailable-banner')).toBeVisible({ timeout: 30_000 });
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
    // `aliceLogin` mounts WalletScreen, whose `useCapabilities.fetch`
    // fires and populates `network` in the Network store. Wait for that
    // first roundtrip to settle BEFORE installing the route block —
    // otherwise the in-flight response sneaks past the intercept and
    // writes `network` back to its real value as soon as Settings has
    // rendered, re-introducing the Network row and turning the loading
    // baseline into a flake.
    type StoreShim = {
      getState: () => { network: string };
      setState: (s: Record<string, unknown>) => void;
    };
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const w = window as unknown as { __useNetworkStore?: StoreShim };
            return w.__useNetworkStore?.getState().network ?? '';
          }),
        { timeout: 10_000 },
      )
      .not.toBe('');

    // Block any further /v1/info call from racing past us. The store
    // is exposed on `window.__useNetworkStore` in `src/stores/network.ts`
    // for this purpose.
    await page.route('**/v1/info', async (route) => {
      await new Promise((r) => setTimeout(r, 8_000));
      await route.continue();
    });
    await page.evaluate(() => {
      const w = window as unknown as { __useNetworkStore?: StoreShim };
      w.__useNetworkStore?.setState({ network: '' });
    });
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-heading')).toBeVisible({ timeout: 10_000 });
    // The About "Network" row is `{network && …}`-gated, so with an empty
    // network it is absent while the always-present node host still
    // renders. This baseline captures that network-not-loaded view.
    await expect(page.getByTestId('settings-node-host')).toBeVisible({ timeout: 10_000 });
    await snap(page, '09-network-loading');
  });
});
