/**
 * Spec 09 — Network badge + AppShell chrome
 *
 * Covers § 8.9 of e2e/README.md. The MVP "Network info badge" function
 * plus the navigation chrome that wraps every other screen (BottomNav
 * tab states, FooterLinks row + grid variants). 6 tests, 6 baselines.
 *
 * DEV-only widgets visible in these baselines (per § 8.0 (b)):
 *   - Apps tab in BottomNav
 *   - `dev-*` hostnames in the FooterLinks (row + grid)
 */

import { expect, test } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('Network badge + AppShell', () => {
  test.beforeEach(async ({ page }) => {
    await setViewport(page, 'desktop');
    await aliceLogin(page);
  });

  test('shell-bottomnav-wallet-active', async ({ page }) => {
    // Default — Alice landed on /, Wallet tab is active. Use the
    // BottomNav as the clip target so the surrounding (masked) balance
    // area doesn't dominate the baseline.
    const nav = page.locator('nav[aria-label="Resources"], nav').last();
    await expect(nav).toBeVisible();
    await snap(page, '09-shell-bottomnav-wallet-active');
  });

  test('shell-bottomnav-settings-active', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10_000,
    });
    await snap(page, '09-shell-bottomnav-settings-active');
  });

  test('shell-footerlinks-row', async ({ page }) => {
    // The FooterLinks row variant lives under AppShell on every page.
    // Capture from the wallet (Alice is already there).
    await expect(page.getByRole('link', { name: 'Network' })).toBeVisible();
    await snap(page, '09-shell-footerlinks-row');
  });

  test('shell-footerlinks-grid', async ({ page }) => {
    // Grid variant is inside Settings § Resources.
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Resources' })).toBeVisible({
      timeout: 10_000,
    });
    await snap(page, '09-shell-footerlinks-grid', { fullPage: true });
  });

  test('network-badge-signet', async ({ page }) => {
    // Network badge is rendered on the Settings header — go there.
    await page.getByRole('link', { name: 'Settings' }).click();
    // The badge text is whatever `network` /api/info returned. We
    // assert the badge is visible without pinning the exact label.
    await expect(page.locator('header').last()).toBeVisible({ timeout: 10_000 });
    await snap(page, '09-network-badge-signet');
  });

  test('network-badge-loading', async ({ page }) => {
    // Intercept /api/info with a long delay so the badge has time to
    // render its loading state on the Settings header.
    await page.route('**/api/info', async (route) => {
      await new Promise((r) => setTimeout(r, 8_000));
      await route.continue();
    });
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
      timeout: 10_000,
    });
    await snap(page, '09-network-badge-loading');
  });
});
