/**
 * Spec 11 — Cross-route redirects (no-account guard)
 *
 * Covers § 8.11 of e2e/README.md. The `/send`, `/receive`, `/settings`
 * routes all render a brief "Redirecting to wallet…" placeholder when
 * they detect no account in the store, then `router.replace('/')` after
 * 100 ms. 3 tests, 3 baselines.
 *
 * Trick used to capture the placeholder
 * --------------------------------------
 * Each guard schedules the redirect via `setTimeout(..., 100)`. We
 * monkey-patch `setTimeout` BEFORE the page loads to stretch any
 * 100-ms timer to 30 s (well past the screenshot). The pattern is
 * surgical — production code does not schedule unrelated 100-ms timers
 * on these routes — but if collisions appear later, switch to a more
 * specific match (e.g. function-source inspection).
 *
 * Locators: testid-based.
 */

import { expect, test } from '@playwright/test';
import { clearWalletState } from './_helpers/wallet';
import { snap, setViewport } from './_helpers/screenshot';

const STRETCH_REDIRECT_TIMEOUT = `
  const _origSetTimeout = window.setTimeout;
  window.setTimeout = function(fn, delay, ...rest) {
    if (delay === 100) return _origSetTimeout(fn, 30_000, ...rest);
    return _origSetTimeout(fn, delay, ...rest);
  };
`;

test.describe('Cross-route redirects — no account', () => {
  test.beforeEach(async ({ page }) => {
    await setViewport(page, 'desktop');
    await clearWalletState(page);
    // Stretch the 100 ms `router.replace('/')` timer so the placeholder
    // remains stable for the screenshot.
    await page.addInitScript({ content: STRETCH_REDIRECT_TIMEOUT });
  });

  test('send-no-account-redirect', async ({ page }) => {
    await page.goto('/send');
    await expect(page.getByTestId('redirecting-placeholder')).toBeVisible({ timeout: 5_000 });
    await snap(page, '11-send-no-account-redirect');
  });

  test('receive-no-account-redirect', async ({ page }) => {
    await page.goto('/receive');
    await expect(page.getByTestId('redirecting-placeholder')).toBeVisible({ timeout: 5_000 });
    await snap(page, '11-receive-no-account-redirect');
  });

  test('settings-no-account-redirect', async ({ page }) => {
    // Settings does NOT use the "Redirecting to wallet…" placeholder — it
    // renders the page with `{account && …}` sections suppressed and the
    // 100 ms redirect fires from useEffect. We baseline the empty-body
    // state and assert on the Settings heading.
    await page.goto('/settings');
    await expect(page.getByTestId('settings-heading')).toBeVisible({ timeout: 5_000 });
    await snap(page, '11-settings-no-account-redirect');
  });
});
