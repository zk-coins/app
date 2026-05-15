/**
 * Spec 05 — Disconnect wallet
 *
 * Covers § 8.5 of e2e/README.md. Settings page reached from Alice's
 * wallet, every interactive widget exercised. 7 tests, 7 linux baselines.
 *
 * DEV-only widgets visible in these baselines (per § 8.0 (b)):
 *   - Apps tab in BottomNav (FEATURES.APPS_DIRECTORY)
 *   - `dev-*` hostnames in the FooterLinks grid inside § Resources
 */

import { expect, test } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('Disconnect wallet', () => {
  test.beforeEach(async ({ page }) => {
    await aliceLogin(page);
  });

  test('wallet-to-settings-nav', async ({ page }) => {
    await setViewport(page, 'desktop');
    // Hover on the Settings tab so the link colour transition lands.
    const settingsTab = page.getByRole('link', { name: 'Settings' });
    await settingsTab.hover();
    await page.waitForTimeout(200);
    await snap(page, '05-wallet-to-settings-nav');
  });

  test('settings-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await snap(page, '05-settings-desktop', { fullPage: true });
  });

  test('settings-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await snap(page, '05-settings-mobile', { fullPage: true });
  });

  test('settings-disconnect-hover', async ({ page }) => {
    await setViewport(page, 'desktop');
    await page.goto('/settings');
    const disconnect = page.getByRole('button', { name: 'Disconnect Wallet' });
    await expect(disconnect).toBeVisible();
    await disconnect.scrollIntoViewIfNeeded();
    await disconnect.hover();
    await page.waitForTimeout(200);
    await snap(page, '05-settings-disconnect-hover');
  });

  test('disconnect-confirm-dialog', async ({ page }) => {
    await setViewport(page, 'desktop');
    await page.goto('/settings');
    // The dialog itself is browser chrome (window.confirm) and can't
    // be captured by Playwright's screenshot. This test asserts the
    // dialog's message text and screenshots the underlying settings
    // page at the moment the dialog handler fires.
    let dialogMessage = '';
    page.once('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.dismiss(); // keep wallet around for the screenshot
    });
    await page.getByRole('button', { name: 'Disconnect Wallet' }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Disconnect Wallet' }).click();
    expect(dialogMessage).toContain('Disconnect this wallet');
    await snap(page, '05-disconnect-confirm-dialog');
  });

  test('post-disconnect-welcome', async ({ page }) => {
    test.setTimeout(60_000);
    await setViewport(page, 'desktop');
    await page.goto('/settings');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Disconnect Wallet' }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Disconnect Wallet' }).click();
    await expect(page.getByText('Welcome to zkCoins')).toBeVisible({ timeout: 15_000 });
    await snap(page, '05-post-disconnect-welcome', { fullPage: true });
  });

  test('disconnect-cancel-noop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await page.goto('/settings');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Disconnect Wallet' }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Disconnect Wallet' }).click();
    // Wallet should still be there.
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    // Verify address chip still rendered (would be gone after disconnect).
    await expect(page.locator('text=/[0-9a-f]{8}@zkcoins\\.app/').first()).toBeVisible();
    await snap(page, '05-disconnect-cancel-noop', { fullPage: true });
  });
});
