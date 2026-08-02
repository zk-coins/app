/**
 * Spec 04 — Unlock wallet (password)
 *
 * Covers § 8.4 of e2e/README.md. Cold-start the app with Alice's
 * encrypted blob in IndexedDB and `authMethod='seed'` in localStorage,
 * so `Home` renders `UnlockScreen`. 6 tests, 5 linux baselines (the
 * reset-flow test is functional-only — the post-wipe screen is the
 * Welcome screen already baselined by 01-onboarding-welcome).
 *
 * Closes the coverage gap noted in README.md (no E2E coverage on
 * `Unlock wallet — password` previously).
 *
 * DEV-only widgets visible in these baselines: none — the unlock
 * screen has no gated UI.
 *
 * Note on the removed `unlock-unlocking` test: the `data-unlocking="true"`
 * frame on the submit button is too short-lived to snapshot deterministically
 * (`unlockWithPassword` resolves before `toHaveScreenshot` triggers), and the
 * post-unlock landing is already covered by `unlock-success-wallet`. The
 * `data-unlocking` attribute itself is still useful as a synchronous DOM
 * marker for functional assertions, just not for visual regression.
 *
 * The reset-link branch (PR #132) adds two functional tests that exercise
 * the `unlock-reset-btn` escape hatch:
 *   - `unlock-reset-link-visible`: the link renders next to the password
 *     form, baselined via `04-unlock-reset-link` so a reflow that hides
 *     or re-styles it gets caught by visual regression.
 *   - `unlock-reset-flow-wipes-and-shows-onboarding`: click → accept the
 *     native confirm → the encrypted wallet is wiped and `Home` falls
 *     through to `<Onboarding />`. Welcome screen is already baselined
 *     by 01-onboarding-welcome, so this one asserts visibility only.
 *
 * Locators: testid-based. The wrong-password test still asserts on the
 * literal `Incorrect password` text — there is only one error on this
 * screen, so a `data-error-kind` discriminator would be redundant, but
 * i18n still requires updating the assertion to the localised string.
 */

import { expect, test, type Page } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { getUsernameDomain, zkAddressRegex } from './_helpers/api';
import { snap, setViewport } from './_helpers/screenshot';

const PASSWORD = 'TestPass123!';

/**
 * Set up the UnlockScreen state: drive the restore flow once so the
 * encrypted blob lands in IndexedDB, then navigate to a fresh page so
 * `Home` sees `hasStoredWallet=true` + `account=null` and renders
 * UnlockScreen.
 */
async function arriveAtUnlock(page: Page): Promise<void> {
  await aliceLogin(page, PASSWORD);
  // Force `Home` to re-evaluate: clear the in-memory account but leave
  // IDB intact. A reload achieves this — checkForStoredWallet on mount
  // sees the encrypted blob and sets hasStoredWallet=true, isLocked=true.
  await page.goto('/?reload=1');
  await expect(page.getByTestId('unlock-heading')).toBeVisible({ timeout: 15_000 });
}

test.describe('Unlock wallet — password', () => {
  test.beforeEach(async ({ page }) => {
    await setViewport(page, 'mobile');
  });

  test('unlock-empty', async ({ page }) => {
    await arriveAtUnlock(page);
    const pw = page.getByTestId('unlock-password-input');
    await expect(pw).toBeVisible();
    await expect(pw).toHaveValue('');
    await expect(page.getByTestId('unlock-submit-btn')).toBeDisabled();
    await snap(page, '04-unlock-empty');
  });

  test('unlock-typed', async ({ page }) => {
    await arriveAtUnlock(page);
    await page.getByTestId('unlock-password-input').fill(PASSWORD);
    await expect(page.getByTestId('unlock-submit-btn')).toBeEnabled();
    await snap(page, '04-unlock-typed', {
      mask: [page.getByTestId('unlock-password-input')],
    });
  });

  test('unlock-wrong-error', async ({ page }) => {
    await arriveAtUnlock(page);
    await page.getByTestId('unlock-password-input').fill('WrongPass987!');
    await page.getByTestId('unlock-submit-btn').click();
    await expect(page.getByTestId('unlock-error')).toBeVisible({ timeout: 10_000 });
    // i18n-todo: text assertion drops out when copy is translated; only
    // one error path on this screen, so visibility alone is sufficient
    // for the regression signal.
    await expect(page.getByTestId('unlock-error')).toHaveText(/Incorrect password/);
    await snap(page, '04-unlock-wrong-error', {
      mask: [page.getByTestId('unlock-password-input')],
    });
  });

  test('unlock-success-wallet', async ({ page }) => {
    test.setTimeout(60_000);
    await arriveAtUnlock(page);
    await page.getByTestId('unlock-password-input').fill(PASSWORD);
    await page.getByTestId('unlock-submit-btn').click();
    // Suffix is server-reported via /v1/info.username_domain (per-stage).
    const chip = zkAddressRegex(await getUsernameDomain());
    await expect(page.locator(`text=${chip}`).first()).toBeVisible({
      timeout: 30_000,
    });
    // Wait for Alice's first balance-poll tick — see comment in
    // 02-create-seed.spec.ts::wallet-after-create.
    await expect(page.getByTestId('portfolio-unavailable-banner')).toBeVisible({ timeout: 30_000 });
    await snap(page, '04-unlock-success-wallet', { fullPage: true });
  });

  test('unlock-reset-link-visible', async ({ page }) => {
    // The "Forgot password? Reset wallet" link renders under the unlock
    // form as the escape hatch when the user can't remember their
    // password. Baseline the idle state — `04-unlock-empty` already
    // covers the form chrome; this snap is taken at a slightly taller
    // viewport region to include the link below the submit button.
    await arriveAtUnlock(page);
    const resetBtn = page.getByTestId('unlock-reset-btn');
    await expect(resetBtn).toBeVisible();
    await expect(resetBtn).toHaveText(/forgot password\? reset wallet/i);
    await expect(resetBtn).toBeEnabled();
    await snap(page, '04-unlock-reset-link');
  });

  test('unlock-reset-flow-wipes-and-shows-onboarding', async ({ page }) => {
    // Functional flow only — the post-reset screen (Welcome) is already
    // baselined by 01-onboarding-welcome, so this test asserts that the
    // reset chain (deleteWallet → deleteCredential → resetAuth) runs to
    // completion and `Home` falls through to `<Onboarding />`.
    test.setTimeout(60_000);
    await arriveAtUnlock(page);

    // Auto-accept the browser-native confirm. The disconnect spec uses
    // the same `page.once('dialog', …)` pattern (see 05-disconnect.spec.ts
    // ::post-disconnect-welcome) — keep the two flows in sync.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('unlock-reset-btn').click();

    // After the wipe `Home` re-renders Onboarding. The Welcome heading
    // and the create-wallet CTA are both gated on `account=null` +
    // `hasStoredWallet=false`, so their visibility proves the reset
    // chain ran end-to-end.
    await expect(page.getByTestId('welcome-heading')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('onboarding-create-btn')).toBeVisible();
    // The unlock chrome must be gone — otherwise the wipe was partial.
    await expect(page.getByTestId('unlock-heading')).not.toBeVisible();
  });
});
