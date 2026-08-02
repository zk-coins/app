/**
 * Spec 02 — Create wallet (seed phrase)
 *
 * Covers § 8.2 of e2e/README.md. Drives Welcome → CREATE WALLET → (PasskeyFlow
 * intro — traversed, no shot) → OTHER LOGIN OPTIONS → SeedFlow through every
 * stage. 10 tests, 9 linux baselines, 1 no-shot. The `creating` shot from
 * the original plan was dropped — the state is too transient to snapshot.
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
import { clearWalletState, waitForBalanceLoaded } from './_helpers/wallet';
import { getUsernameDomain, zkAddressRegex } from './_helpers/api';
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

  test.describe('generating stage', () => {
    // The PWA service worker (public/sw.js) serves static assets
    // cache-first, and requests answered by a worker bypass
    // `page.route()` entirely — so the WASM hold below would never
    // fire. Same reasoning as spec 13's file-level block; scoped to
    // this inner describe because only this capture depends on
    // intercepting the WASM fetch.
    test.use({ serviceWorkers: 'block' });

    test('seed-generating', async ({ page }) => {
      // Hold the WASM fetch so the `generating` stage is still on
      // screen when the snapshot is taken, on any runner speed. The
      // previous 800 ms budget raced `snap()`'s own pre-capture work
      // (fonts.ready, the /v1/info round-trip that builds the default
      // masks, the stabilizer CSS): on a fast locally-served standalone
      // build the WASM landed first, the seed grid rendered, and the
      // (masked) grid no longer matched the text-only baseline. The
      // 30 s hold cannot slow the test down — the spec ends right after
      // `snap()` and Playwright aborts the still-pending request when
      // the page closes; it only pins the UI in `generating` for
      // however long the snapshot itself takes.
      //
      // Glob note: `@zkcoins/wasm` ships `client_bg.wasm`, which Next
      // emits hashed as `client_bg.<hash>.wasm` under
      // `/_next/static/media/`. The previous `**/zkcoins_wasm_bg.wasm`
      // glob matched nothing, so the hold never fired and the captured
      // frame was pure timing luck — fine on the slower hosted-stack
      // round-trip, broken on a fast locally-served build where the
      // grid rendered before the snapshot.
      await page.route('**/client_bg*.wasm', async (route) => {
        await new Promise((r) => setTimeout(r, 30_000));
        await route.continue().catch(() => {});
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
  // first `/v1/balance` round-trip — there is no stable window to
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
    // Suffix is server-reported via /v1/info.username_domain (per-stage).
    const chip = zkAddressRegex(await getUsernameDomain());
    await expect(page.locator(`text=${chip}`).first()).toBeVisible({
      timeout: 30_000,
    });
    // Block on the first /v1/balance tick so the banner check below is
    // deterministic. The banner renders for `balance === 0` and remains
    // absent while `balance === null` (post-mount loading) — without an
    // explicit wait the assertion races the polling tick.
    await waitForBalanceLoaded(page);
    await expect(page.getByTestId('wallet-empty-banner')).toBeVisible({ timeout: 5_000 });
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
