/**
 * Spec 12 — Accessibility regression (axe-core)
 *
 * Issue #68 / Workstream 2.
 *
 * Runs axe-core against every reachable MVP route and fails on any
 * `serious` or `critical` WCAG 2 A/AA violation that is not in
 * `KNOWN_VIOLATIONS` (see below). Each allowlist entry is a
 * `(rule id, route, reason)` tuple — different routes can independently
 * allow or disallow the same rule.
 *
 * The initial allowlist is populated with the violations the first CI
 * run surfaced against DEV. Per issue #68: "Fixes go in follow-up PRs,
 * one per route." When a follow-up lands and the route comes clean,
 * remove the corresponding entry below.
 *
 * No screenshots, no visual baseline — these are purely functional
 * axe checks. The spec runs in the regular E2E job; the visual-baseline
 * regen workflow (`e2e/0*.spec.ts e2e/1*.spec.ts`) does match it by
 * glob but finds nothing to update because the spec emits zero
 * `toHaveScreenshot` calls. No PNG output, no false-positive baseline
 * commits.
 */

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { aliceLogin } from './_helpers/fixtures';
import { clearWalletState } from './_helpers/wallet';

/** See file header for the allowlist policy. */
const KNOWN_VIOLATIONS: Array<{ id: string; route: string; reason: string }> = [
  {
    id: 'color-contrast',
    route: '/',
    reason:
      'Wallet home (Alice) — muted ink2/ink3 text on dark surface falls below 4.5:1 on a handful of nodes. Tracked: follow-up issue.',
  },
  {
    id: 'color-contrast',
    route: '/ (seed-reveal)',
    reason:
      'Onboarding seed-reveal — muted helper text + revealed mnemonic cells. Tracked: follow-up issue.',
  },
  {
    id: 'color-contrast',
    route: '/send',
    reason:
      'Send page — placeholder text and the "BTC" suffix sit below 4.5:1 on the dark input surface. Tracked: follow-up issue.',
  },
  {
    id: 'color-contrast',
    route: '/receive',
    reason: 'Receive page — same muted-text palette as wallet home. Tracked: follow-up issue.',
  },
  {
    id: 'svg-img-alt',
    route: '/receive',
    reason:
      'QR code <svg> is rendered without an accessible name. Tracked: follow-up issue (add aria-label="Receive address QR code").',
  },
  {
    id: 'color-contrast',
    route: '/settings',
    reason:
      'Settings page — section headers and the Disconnect button border/text fall below 4.5:1 on the dark surface. Tracked: follow-up issue.',
  },
];

const AXE_TAGS = ['wcag2a', 'wcag2aa'];
const BLOCKING_IMPACTS = ['serious', 'critical'] as const;

async function runAxe(page: Page, route: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

  const blocking = violations.filter((v) => {
    const impact = v.impact ?? '';
    if (!(BLOCKING_IMPACTS as readonly string[]).includes(impact)) return false;
    const allowed = KNOWN_VIOLATIONS.some((k) => k.id === v.id && k.route === route);
    return !allowed;
  });

  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
      .join('\n');
    throw new Error(`axe found ${blocking.length} blocking violation(s) on ${route}:\n${summary}`);
  }
  // Force at least one positive assertion so a green test isn't a no-op.
  expect(blocking).toHaveLength(0);
}

test.describe('Accessibility (axe-core, wcag2aa)', () => {
  test('welcome (logged-out landing)', async ({ page }) => {
    await clearWalletState(page);
    await page.goto('/');
    await expect(page.getByTestId('welcome-heading')).toBeVisible();
    await runAxe(page, '/');
  });

  test('onboarding seed-reveal step (logged-out, mid-flow)', async ({ page }) => {
    await clearWalletState(page);
    await page.goto('/');
    await page.getByTestId('onboarding-create-btn').click();
    // Skip PasskeyFlow intro if FEATURES.PASSKEY is on (mirrors createSeedWallet helper).
    const passkeySkip = page.getByTestId('passkey-other-options-btn');
    if (await passkeySkip.isVisible({ timeout: 1500 }).catch(() => false)) {
      await passkeySkip.click();
    }
    await expect(page.getByTestId('seed-flow')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('seed-reveal-btn').click();
    await runAxe(page, '/ (seed-reveal)');
  });

  test('wallet home (Alice, logged in)', async ({ page }) => {
    await aliceLogin(page);
    await runAxe(page, '/');
  });

  test('send page', async ({ page }) => {
    await aliceLogin(page);
    await page.getByTestId('wallet-send-btn').click();
    await expect(page.getByTestId('send-heading')).toBeVisible({ timeout: 10_000 });
    await runAxe(page, '/send');
  });

  test('receive page', async ({ page }) => {
    await aliceLogin(page);
    await page.getByTestId('wallet-receive-btn').click();
    await expect(page.getByTestId('receive-heading')).toBeVisible({ timeout: 10_000 });
    await runAxe(page, '/receive');
  });

  test('settings page', async ({ page }) => {
    await aliceLogin(page);
    // Client-side nav via BottomNav — a full `page.goto('/settings')`
    // reload re-initialises the store, the wallet locks, and /settings
    // redirects to /. Mirrors `goToSettings` in e2e/05-disconnect.spec.ts.
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-disconnect-btn')).toBeVisible({ timeout: 10_000 });
    await runAxe(page, '/settings');
  });
});
