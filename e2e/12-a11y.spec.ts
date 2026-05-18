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
 * The allowlist below carries one entry — the residual seed-grid
 * `text-ink4` index labels axe still flags after #83. (`aria-hidden`
 * is correct for screen readers but the axe color-contrast rule does
 * not exempt the element itself, only descendants of an ancestor
 * `aria-hidden`.) This PR bumps those labels to `text-ink3`; the
 * trailing follow-up PR empties the array once the DEV deploy lands.
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
    route: '/ (seed-reveal)',
    reason:
      'Seed-grid index labels at ink4 (2.01:1) — bumped to ink3 in this PR; entry removed in the follow-up after the DEV deploy.',
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
