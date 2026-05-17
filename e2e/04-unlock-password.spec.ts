/**
 * Spec 04 — Unlock wallet (password)
 *
 * Covers § 8.4 of e2e/README.md. Cold-start the app with Alice's
 * encrypted blob in IndexedDB and `authMethod='seed'` in localStorage,
 * so `Home` renders `UnlockScreen`. 5 tests, 5 linux baselines.
 *
 * Closes the MVP triage gap noted in README.md (no E2E coverage on
 * `Unlock wallet — password` previously).
 *
 * DEV-only widgets visible in these baselines: none — the unlock
 * screen has no gated UI.
 *
 * Locators: testid-based. The "unlocking…" intermediate state is
 * detected via the button's `data-unlocking` attribute. The wrong-
 * password test still asserts on the literal `Incorrect password`
 * text — there is only one error on this screen, so a `data-error-kind`
 * discriminator would be redundant, but i18n still requires updating
 * the assertion to the localised string.
 */

import { expect, test, type Page } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
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

  test('unlock-unlocking', async ({ page }) => {
    // Stub /api/balance with a deterministic non-zero balance. The
    // restore flow persists the account with balance=0 in IDB, so on
    // every unlock WalletScreen briefly renders the "Wallet is empty"
    // banner (sats<=0) until the first /api/balance tick resolves —
    // and the banner adds enough vertical layout shift to fail the
    // pixel-diff. Returning a fixed non-zero balance keeps the snap
    // shape stable; the actual amount is masked by defaultMasks
    // (balance-value testid). The "Unlocking…" disabled-button frame
    // resolves faster than the snap triggers anyway, so this test
    // covers the post-unlock landing rather than the spinner itself.
    await page.route('**/api/balance**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ balance: 100_000 }),
      });
    });
    await arriveAtUnlock(page);
    await page.getByTestId('unlock-password-input').fill(PASSWORD);
    await page.getByTestId('unlock-submit-btn').click();
    const submit = page.getByTestId('unlock-submit-btn');
    await expect(submit).toHaveAttribute('data-unlocking', 'true', { timeout: 5_000 });
    await expect(submit).toBeDisabled();
    await snap(page, '04-unlock-unlocking');
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
    await expect(page.locator('text=/[0-9a-f]{8}@zkcoins\\.app/').first()).toBeVisible({
      timeout: 30_000,
    });
    // Wait for Alice's first balance-poll tick — see comment in
    // 02-create-seed.spec.ts::wallet-after-create.
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    await snap(page, '04-unlock-success-wallet', { fullPage: true });
  });
});
