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
 *
 * Locators are testid-based. The two password-validation error tests
 * (too-short, mismatch) still assert on the literal English message
 * because both errors share the `seed-error` container — distinguishing
 * them by text is the only way today. Both lines are marked `i18n-todo`
 * to be replaced with `data-error-kind` discriminators when i18n lands.
 */

import { expect, test, type Page } from '@playwright/test';
import { clearWalletState } from './_helpers/wallet';
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

  test('seed-generating', async ({ page }) => {
    // Race the WASM with a small artificial slowdown so the `generating`
    // stage is captured before it transitions to `reveal`.
    await page.route('**/zkcoins_wasm_bg.wasm', async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.goto('/');
    await page.getByTestId('onboarding-create-btn').click();
    const passkeySkip = page.getByTestId('passkey-other-options-btn');
    if (await passkeySkip.isVisible({ timeout: 1500 }).catch(() => false)) {
      await passkeySkip.click();
    }
    await expect(page.getByTestId('seed-generating')).toBeVisible({ timeout: 5_000 });
    await snap(page, '02-seed-generating');
  });

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
    // i18n-todo: distinguish too-short vs mismatch via data-error-kind once i18n lands.
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
    // i18n-todo: distinguish too-short vs mismatch via data-error-kind once i18n lands.
    await expect(page.getByTestId('seed-error')).toHaveText(/Passwords do not match/);
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
    await page.getByTestId('seed-reveal-btn').click();
    await page.getByTestId('seed-written-btn').click();
    await page.getByTestId('seed-confirm-btn').click();
    await page.getByTestId('seed-password-input').fill(PASSWORD);
    await page.getByTestId('seed-password-confirm-input').fill(PASSWORD);
    await page.getByTestId('seed-create-btn').click();
    // Wait for the wallet screen — the chip is the most reliable marker.
    await expect(page.locator('text=/[0-9a-f]{8}@zkcoins\\.app/').first()).toBeVisible({
      timeout: 30_000,
    });
    // Empty banner is the *correct* end state — this is a brand-new
    // wallet, no faucet, balance is genuinely zero. The banner renders
    // only after the first /api/balance tick resolves with 0 (see
    // WalletScreen's `balance === 0` guard), so wait for it explicitly
    // before snap — otherwise the test races the polling tick. The
    // baseline ends up visually identical to `06-balance-zero-empty-banner`
    // and that is fine: both tests assert the empty-wallet rendering, just
    // from different code paths.
    await expect(page.getByTestId('wallet-empty-banner')).toBeVisible({ timeout: 30_000 });
    await snap(page, '02-wallet-after-create', { fullPage: true });
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
        .getByTestId('passkey-other-options-btn')
        .isVisible()
        .catch(() => false)
    ) {
      await page.locator('button').first().click();
    }
    await expect(page.getByTestId('welcome-heading')).toBeVisible({ timeout: 10_000 });
  });
});
