/**
 * Spec 02 — Create wallet (seed phrase)
 *
 * Covers § 8.2 of e2e/README.md. Drives Welcome → CREATE WALLET → (PasskeyFlow
 * intro — traversed, no shot) → OTHER LOGIN OPTIONS → SeedFlow through every
 * stage. 10 tests, 9 linux baselines, 1 no-shot. The `creating` shot from
 * the original plan was dropped — the state is too transient to snapshot.
 *
 * DEV-only widgets visible in these baselines (per § 8.0 (b)):
 *   - `dev-*` hostnames in the FooterLinks below the card on Welcome screens.
 *
 * `beforeEach` wipes IDB + localStorage so every test starts from a blank
 * slate (Onboarding renders, not WalletScreen / UnlockScreen).
 */

import { expect, test, type Page } from '@playwright/test';
import { clearWalletState } from './_helpers/wallet';
import { snap, setViewport } from './_helpers/screenshot';

const PASSWORD = 'TestPass123!';

/** Walk Welcome → CREATE WALLET → OTHER LOGIN OPTIONS into SeedFlow. */
async function enterSeedFlow(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByText('CREATE WALLET').click();
  // DEV-bundle artefact: passkey-intro screen. Click through without
  // taking a baseline (see § 8.0 (a) in e2e/README.md).
  await page.getByText('OTHER LOGIN OPTIONS').click();
  await expect(page.getByText('Your seed phrase')).toBeVisible({ timeout: 15_000 });
}

test.describe('Create wallet — seed phrase', () => {
  test.beforeEach(async ({ page }) => {
    await setViewport(page, 'desktop');
    await clearWalletState(page);
  });

  test('seed-generating', async ({ page }) => {
    // Race the WASM with a small artificial slowdown so the `generating`
    // stage is captured before it transitions to `reveal`.
    await page.route('**/zkcoins_wasm_bg.wasm', async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.goto('/');
    await page.getByText('CREATE WALLET').click();
    await page.getByText('OTHER LOGIN OPTIONS').click();
    await expect(page.getByText('Generating seed phrase…')).toBeVisible({ timeout: 5_000 });
    await snap(page, '02-seed-generating');
  });

  test('seed-reveal-hidden', async ({ page }) => {
    await enterSeedFlow(page);
    await expect(page.getByText('Tap to reveal')).toBeVisible();
    await snap(page, '02-seed-reveal-hidden');
  });

  test('seed-reveal-shown', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByText('Tap to reveal').click();
    await expect(page.getByText("I've written it down")).toBeVisible();
    await snap(page, '02-seed-reveal-shown');
  });

  test('seed-acknowledged', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByText('Tap to reveal').click();
    await page.getByText("I've written it down").click();
    await expect(page.getByText('Continue', { exact: true })).toBeVisible();
    await snap(page, '02-seed-acknowledged');
  });

  test('password-empty', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByText('Tap to reveal').click();
    await page.getByText("I've written it down").click();
    await page.getByText('Continue', { exact: true }).click();
    await expect(page.getByText('Set an encryption password')).toBeVisible();
    const createBtn = page.getByText('Create wallet', { exact: true });
    await expect(createBtn).toBeDisabled();
    await snap(page, '02-password-empty');
  });

  test('password-filled', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByText('Tap to reveal').click();
    await page.getByText("I've written it down").click();
    await page.getByText('Continue', { exact: true }).click();
    const pw = page.locator('input[type="password"]');
    await pw.first().fill(PASSWORD);
    await pw.last().fill(PASSWORD);
    await expect(page.getByText('Create wallet', { exact: true })).toBeEnabled();
    await snap(page, '02-password-filled');
  });

  test('password-too-short', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByText('Tap to reveal').click();
    await page.getByText("I've written it down").click();
    await page.getByText('Continue', { exact: true }).click();
    const pw = page.locator('input[type="password"]');
    await pw.first().fill('short');
    await pw.last().fill('short');
    await page.getByText('Create wallet', { exact: true }).click();
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible({
      timeout: 5_000,
    });
    await snap(page, '02-password-too-short');
  });

  test('password-mismatch', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByText('Tap to reveal').click();
    await page.getByText("I've written it down").click();
    await page.getByText('Continue', { exact: true }).click();
    const pw = page.locator('input[type="password"]');
    await pw.first().fill(PASSWORD);
    await pw.last().fill('DifferentPass456!');
    await page.getByText('Create wallet', { exact: true }).click();
    await expect(page.getByText('Passwords do not match')).toBeVisible({ timeout: 5_000 });
    await snap(page, '02-password-mismatch');
  });

  // The `creating` baseline from the plan was dropped: SeedFlow's
  // `create` callback runs `wasm.createAccountFromMnemonic` and
  // `saveWithPassword` (IDB encrypt) in series, both finish in <50 ms,
  // and `setAuth` swaps `Home` to render `WalletScreen` before the
  // first `/api/balance` round-trip — there is no stable window to
  // snapshot the "Creating…" disabled-button state. The transition is
  // covered functionally by `wallet-after-create`. Plan totals
  // updated in e2e/README.md § 8.13.

  test('wallet-after-create', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByText('Tap to reveal').click();
    await page.getByText("I've written it down").click();
    await page.getByText('Continue', { exact: true }).click();
    const pw = page.locator('input[type="password"]');
    await pw.first().fill(PASSWORD);
    await pw.last().fill(PASSWORD);
    await page.getByText('Create wallet', { exact: true }).click();
    // Wait for the wallet screen — the chip is the most reliable marker.
    await expect(page.locator('text=/[0-9a-f]{8}@zkcoins\\.app/').first()).toBeVisible({
      timeout: 30_000,
    });
    await snap(page, '02-wallet-after-create');
  });

  test('back-from-reveal (no shot)', async ({ page }) => {
    await enterSeedFlow(page);
    // The StepHeader back button is the first `<button>` rendered.
    // In the DEV bundle SeedFlow's `onBack` goes to PasskeyFlow (not
    // straight to Welcome — see § 8.0 (a)), so click back twice to
    // land on Welcome. PRD only needs one click; both paths are
    // accepted via the final assertion.
    await page.locator('button').first().click();
    if (
      await page
        .getByText('OTHER LOGIN OPTIONS')
        .isVisible()
        .catch(() => false)
    ) {
      await page.locator('button').first().click();
    }
    await expect(page.getByText('Welcome to zkCoins')).toBeVisible({ timeout: 10_000 });
  });
});
