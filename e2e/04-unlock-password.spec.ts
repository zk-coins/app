/**
 * Spec 04 — Unlock wallet (password)
 *
 * Covers § 8.4 of e2e/README.md. Cold-start the app with Alice's
 * encrypted blob in IndexedDB and `authMethod='seed'` in localStorage,
 * so `Home` renders `UnlockScreen`. 4 tests, 4 linux baselines.
 *
 * Closes the MVP triage gap noted in README.md (no E2E coverage on
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
 * Locators: testid-based. The wrong-password test still asserts on the
 * literal `Incorrect password` text — there is only one error on this
 * screen, so a `data-error-kind` discriminator would be redundant, but
 * i18n still requires updating the assertion to the localised string.
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
