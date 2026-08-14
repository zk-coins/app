/**
 * Spec 02 — Create wallet (seed phrase)
 *
 * Covers § 8.2 of e2e/README.md. Drives Welcome → CREATE WALLET → (PasskeyFlow
 * intro — traversed, no shot) → OTHER LOGIN OPTIONS → SeedFlow through every
 * stage. 9 tests / 8 shots, 1 no-shot. The `creating` shot from
 * the original plan was dropped — the state is too transient to snapshot.
 *
 * `beforeEach` wipes IDB + localStorage so every test starts from a blank
 * slate (Onboarding renders, not WalletScreen / UnlockScreen).
 *
 * Locators are testid-based. The two password-validation error tests
 * (too-short, mismatch) still assert on the literal English message
 * because both errors share the `seed-error` container — distinguishing
 * them by text is the only way today.
 */

import { expect, test, type Page } from '@playwright/test';
import { clearWalletState, waitForBalanceLoaded } from './_helpers/wallet';
import { snap, setViewport } from './_helpers/screenshot';

const PASSWORD = 'TestPass123!';

/** Walk Welcome → CREATE WALLET → SeedFlow. Skips a PasskeyFlow intro
 *  screen if FEATURES.PASSKEY is on (local dev only after issue #30). */
async function enterSeedFlow(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('onboarding-create-btn').click();
  const passkeySkip = page.getByTestId('passkey-other-options-btn');
  if (await passkeySkip.isVisible({ timeout: 1500 }).catch(() => false)) {
    await passkeySkip.click();
  }
  await expect(page.getByTestId('seed-flow')).toBeVisible({ timeout: 15_000 });
}

test.describe('Create wallet — seed phrase', () => {
  test.beforeEach(async ({ page }) => {
    await setViewport(page, 'mobile');
    await clearWalletState(page);
  });

  // seed-generating: pure-TS `@zkcoins/sdk` mnemonic generation is near-
  // instant, so the generating stage is a transient flash with no network
  // resource to hold. The unstable visual capture was dropped rather than
  // faking a missing WASM module. Functional coverage is the reveal stages
  // below plus the unit suite on account-keys.

  test('seed-reveal-hidden', async ({ page }) => {
    await enterSeedFlow(page);
    await expect(page.getByTestId('seed-reveal-btn')).toBeVisible();
    await snap(page, '02-seed-reveal-hidden');
  });

  test('seed-reveal-shown', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByTestId('seed-reveal-btn').click();
    await expect(page.getByTestId('seed-written-btn')).toBeVisible();
    await snap(page, '02-seed-reveal-shown');
  });

  test('seed-acknowledged', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByTestId('seed-reveal-btn').click();
    await page.getByTestId('seed-written-btn').click();
    await expect(page.getByTestId('seed-confirm-btn')).toBeVisible();
    await snap(page, '02-seed-acknowledged');
  });

  test('password-empty', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByTestId('seed-reveal-btn').click();
    await page.getByTestId('seed-written-btn').click();
    await page.getByTestId('seed-confirm-btn').click();
    await expect(page.getByTestId('seed-password-stage')).toBeVisible();
    await expect(page.getByTestId('seed-create-btn')).toBeDisabled();
    await snap(page, '02-password-empty');
  });

  test('password-filled', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByTestId('seed-reveal-btn').click();
    await page.getByTestId('seed-written-btn').click();
    await page.getByTestId('seed-confirm-btn').click();
    await page.getByTestId('seed-password-input').fill(PASSWORD);
    await page.getByTestId('seed-password-confirm-input').fill(PASSWORD);
    await expect(page.getByTestId('seed-create-btn')).toBeEnabled();
    await snap(page, '02-password-filled');
  });

  test('password-too-short', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByTestId('seed-reveal-btn').click();
    await page.getByTestId('seed-written-btn').click();
    await page.getByTestId('seed-confirm-btn').click();
    await page.getByTestId('seed-password-input').fill('short');
    await page.getByTestId('seed-password-confirm-input').fill('short');
    await page.getByTestId('seed-create-btn').click();
    await expect(page.getByTestId('seed-error')).toBeVisible({ timeout: 5_000 });
    // Onboarding copy is not in the message catalog yet, so this asserts the literal English message.
    await expect(page.getByTestId('seed-error')).toHaveText(
      /Password must be at least 8 characters/,
    );
    await snap(page, '02-password-too-short');
  });

  test('password-mismatch', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByTestId('seed-reveal-btn').click();
    await page.getByTestId('seed-written-btn').click();
    await page.getByTestId('seed-confirm-btn').click();
    await page.getByTestId('seed-password-input').fill(PASSWORD);
    await page.getByTestId('seed-password-confirm-input').fill('DifferentPass456!');
    await page.getByTestId('seed-create-btn').click();
    await expect(page.getByTestId('seed-error')).toBeVisible({ timeout: 5_000 });
    // Onboarding copy is not in the message catalog yet, so this asserts the literal English message.
    await expect(page.getByTestId('seed-error')).toHaveText(/Passwords do not match/);
    await snap(page, '02-password-mismatch');
  });

  // The `creating` baseline from the plan was dropped: SeedFlow's
  // `create` callback runs pure-TS `@zkcoins/sdk` account derivation and
  // `saveWithPassword` (IDB encrypt) in series, both finish in <50 ms,
  // and `setAuth` swaps `Home` to render `WalletScreen` before any
  // stable "Creating…" window. Ready is marked by `create-coin-btn` /
  // portfolio-unavailable. Covered functionally by `wallet-after-create`.
  // Plan totals updated in e2e/README.md § 8.13.

  test('wallet-after-create', async ({ page }) => {
    await enterSeedFlow(page);
    await page.getByTestId('seed-reveal-btn').click();
    await page.getByTestId('seed-written-btn').click();
    await page.getByTestId('seed-confirm-btn').click();
    await page.getByTestId('seed-password-input').fill(PASSWORD);
    await page.getByTestId('seed-password-confirm-input').fill(PASSWORD);
    await page.getByTestId('seed-create-btn').click();
    // Wait for the wallet shell — create-coin-btn marks a settled WalletScreen.
    await expect(page.getByTestId('create-coin-btn')).toBeVisible({ timeout: 30_000 });
    // Block until the first portfolio tick settles the unavailable banner
    // (ready path: create-coin-btn + portfolio-unavailable-banner). Without
    // an explicit wait the assertion races the polling tick.
    await waitForBalanceLoaded(page);
    await expect(page.getByTestId('portfolio-unavailable-banner')).toBeVisible({ timeout: 30_000 });
    await snap(page, '02-wallet-after-create', { fullPage: true });
  });

  test('back-from-reveal (no shot)', async ({ page }) => {
    await enterSeedFlow(page);
    // In the DEV bundle SeedFlow's `onBack` goes to PasskeyFlow (not
    // straight to Welcome — see § 8.0 (a)), so click back twice to
    // land on Welcome. PRD only needs one click; both paths are
    // accepted via the final assertion.
    await page.getByTestId('onboarding-step-back-btn').click();
    if (
      await page
        .getByTestId('passkey-other-options-btn')
        .isVisible()
        .catch(() => false)
    ) {
      await page.getByTestId('onboarding-step-back-btn').click();
    }
    await expect(page.getByTestId('welcome-heading')).toBeVisible({ timeout: 10_000 });
  });
});
