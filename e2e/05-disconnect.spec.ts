/**
 * Spec 05 — Disconnect wallet
 *
 * Covers § 8.5 of e2e/README.md. Settings page reached from Alice's
 * wallet, every interactive widget exercised. 7 tests, 7 linux baselines.
 *
 * DEV-only widgets visible in these baselines (per § 8.0 (b)):
 *   - Apps tab in BottomNav (FEATURES.APPS_DIRECTORY)
 *   - `dev-*` hostnames in the FooterLinks grid inside § Resources
 *
 * Locators: testid-based. The `disconnect-confirm-dialog` test still
 * asserts on the dialog's literal message — the browser-native
 * `window.confirm` text is not testid-addressable from the DOM. When
 * i18n lands, that string moves into the translation bundle too and
 * the assertion has to switch to the localised copy.
 */

import { expect, test, type Page } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

/**
 * Reach /settings while logged in. `page.goto('/settings')` does a full
 * page load, which re-initialises the zustand wallet store and locks the
 * wallet — /settings then sees `account=null` and redirects to /. The
 * BottomNav Settings link is a Next.js `<Link>` and navigates client-side
 * with the store intact.
 *
 * Settings has two `{networkName && …}`-gated regions (the badge in the
 * header and the "Network" row in the About section). The store value
 * is populated by WalletScreen's `useEffect(api.info, …)`, which races
 * the in-app navigation here. Without waiting for the badge to land,
 * the snapshot can capture the page ~52 px shorter than the linux
 * baseline (badge + Network row missing) and fail visual regression.
 */
async function goToSettings(page: Page): Promise<void> {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-heading')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('settings-network-badge')).toBeVisible({ timeout: 10_000 });
}

test.describe('Disconnect wallet', () => {
  test.beforeEach(async ({ page }) => {
    await aliceLogin(page);
  });

  test('wallet-to-settings-nav', async ({ page }) => {
    await setViewport(page, 'mobile');
    // Hover on the Settings tab so the link colour transition lands.
    const settingsTab = page.getByTestId('nav-settings');
    await settingsTab.hover();
    await page.waitForTimeout(200);
    await snap(page, '05-wallet-to-settings-nav');
  });

  test('settings-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await goToSettings(page);
    await expect(page.getByTestId('settings-heading')).toBeVisible();
    await snap(page, '05-settings-desktop', { fullPage: true });
  });

  test('settings-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await goToSettings(page);
    await expect(page.getByTestId('settings-heading')).toBeVisible();
    await snap(page, '05-settings-mobile', { fullPage: true });
  });

  test('settings-disconnect-hover', async ({ page }) => {
    await setViewport(page, 'mobile');
    await goToSettings(page);
    const disconnect = page.getByTestId('settings-disconnect-btn');
    await expect(disconnect).toBeVisible();
    await disconnect.scrollIntoViewIfNeeded();
    await disconnect.hover();
    await page.waitForTimeout(200);
    await snap(page, '05-settings-disconnect-hover');
  });

  test('disconnect-confirm-dialog', async ({ page }) => {
    await setViewport(page, 'mobile');
    await goToSettings(page);
    // The dialog itself is browser chrome (window.confirm) and can't
    // be captured by Playwright's screenshot. This test asserts the
    // dialog's message text and screenshots the underlying settings
    // page at the moment the dialog handler fires.
    let dialogMessage = '';
    page.once('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.dismiss(); // keep wallet around for the screenshot
    });
    await page.getByTestId('settings-disconnect-btn').scrollIntoViewIfNeeded();
    await page.getByTestId('settings-disconnect-btn').click();
    // i18n-todo: native confirm() text comes from the app's source
    // string — assertion needs to follow the localised copy.
    expect(dialogMessage).toContain('Disconnect this wallet');
    await snap(page, '05-disconnect-confirm-dialog');
  });

  test('post-disconnect-welcome', async ({ page }) => {
    test.setTimeout(60_000);
    await setViewport(page, 'mobile');
    await goToSettings(page);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('settings-disconnect-btn').scrollIntoViewIfNeeded();
    await page.getByTestId('settings-disconnect-btn').click();
    await expect(page.getByTestId('welcome-heading')).toBeVisible({ timeout: 15_000 });
    await snap(page, '05-post-disconnect-welcome', { fullPage: true });
  });

  test('disconnect-cancel-noop', async ({ page }) => {
    await setViewport(page, 'mobile');
    await goToSettings(page);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByTestId('settings-disconnect-btn').scrollIntoViewIfNeeded();
    await page.getByTestId('settings-disconnect-btn').click();
    // Wallet still there — the heading + the Disconnect button still
    // render (both are `{account && (…)}`-gated, so their continued
    // presence proves the wallet wasn't cleared). Settings page shows
    // the full hex address rather than the `{8hex}@zkcoins.app` chip,
    // so don't match the chip regex here.
    await expect(page.getByTestId('settings-heading')).toBeVisible();
    await expect(page.getByTestId('settings-disconnect-btn')).toBeVisible();
    await snap(page, '05-disconnect-cancel-noop', { fullPage: true });
  });
});
