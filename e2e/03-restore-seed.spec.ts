/**
 * Spec 03 — Restore wallet (seed phrase)
 *
 * Covers § 8.3 of e2e/README.md. Drives Welcome → Restore existing wallet →
 * SeedImportFlow through every stage. 11 tests, 10 linux baselines, 1 no-shot.
 *
 * Reuses Alice's mnemonic from `_global-setup.ts` via `readAccounts()` for
 * the valid-input path. Wrong-count and bad-BIP39 paths use hand-built
 * strings.
 *
 * DEV-only widgets visible in these baselines (per § 8.0 (b)):
 *   - `dev-*` hostnames in the FooterLinks below the card on the Welcome
 *     screen reachable via `back-from-input`.
 *
 * `beforeEach` wipes IDB + localStorage so the test starts on the Welcome
 * screen, not the wallet.
 */

import { expect, test, type Page } from '@playwright/test';
import { clearWalletState } from './_helpers/wallet';
import { readAccounts } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

const PASSWORD = 'TestPass123!';

/** Walk Welcome → Restore existing wallet into SeedImportFlow. */
async function enterImportFlow(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByText('Restore existing wallet').click();
  // The textarea is the only stable marker on stage='input' — the
  // "Restore wallet" text is reused by both the H1 and (later, on
  // stage='password') the submit button, so locating by role/text
  // here would be ambiguous.
  await expect(page.locator('textarea')).toBeVisible({ timeout: 10_000 });
}

test.describe('Restore wallet — seed phrase', () => {
  test.beforeEach(async ({ page }) => {
    await setViewport(page, 'desktop');
    await clearWalletState(page);
  });

  test('restore-entry-empty', async ({ page }) => {
    await enterImportFlow(page);
    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.getByText('Continue', { exact: true })).toBeDisabled();
    await snap(page, '03-restore-entry-empty');
  });

  test('restore-input-typed-valid', async ({ page }) => {
    const { alice } = readAccounts();
    await enterImportFlow(page);
    await page.locator('textarea').fill(alice.mnemonic.join(' '));
    await expect(page.getByText('Continue', { exact: true })).toBeEnabled();
    await snap(page, '03-restore-input-typed-valid', {
      mask: [page.locator('textarea')],
    });
  });

  test('restore-input-wrong-count', async ({ page }) => {
    await enterImportFlow(page);
    await page.locator('textarea').fill('only five words pasted here');
    await page.getByText('Continue', { exact: true }).click();
    await expect(page.getByText('Enter exactly 12 words')).toBeVisible({ timeout: 5_000 });
    await snap(page, '03-restore-input-wrong-count');
  });

  test('restore-input-bad-bip39', async ({ page }) => {
    await enterImportFlow(page);
    // 12 tokens, none of which are valid BIP-39 wordlist entries.
    await page.locator('textarea').fill('zzz zzz zzz zzz zzz zzz zzz zzz zzz zzz zzz zzz');
    await page.getByText('Continue', { exact: true }).click();
    await expect(
      page.getByText('Invalid seed phrase — check your words and try again'),
    ).toBeVisible({ timeout: 5_000 });
    await snap(page, '03-restore-input-bad-bip39');
  });

  test('restore-password-empty', async ({ page }) => {
    const { alice } = readAccounts();
    await enterImportFlow(page);
    await page.locator('textarea').fill(alice.mnemonic.join(' '));
    await page.getByText('Continue', { exact: true }).click();
    await expect(page.getByText('Set an encryption password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore wallet' })).toBeDisabled();
    await snap(page, '03-restore-password-empty');
  });

  test('restore-password-filled', async ({ page }) => {
    const { alice } = readAccounts();
    await enterImportFlow(page);
    await page.locator('textarea').fill(alice.mnemonic.join(' '));
    await page.getByText('Continue', { exact: true }).click();
    const pw = page.locator('input[type="password"]');
    await pw.first().fill(PASSWORD);
    await pw.last().fill(PASSWORD);
    await expect(page.getByRole('button', { name: 'Restore wallet' })).toBeEnabled();
    await snap(page, '03-restore-password-filled');
  });

  test('restore-password-too-short', async ({ page }) => {
    const { alice } = readAccounts();
    await enterImportFlow(page);
    await page.locator('textarea').fill(alice.mnemonic.join(' '));
    await page.getByText('Continue', { exact: true }).click();
    const pw = page.locator('input[type="password"]');
    await pw.first().fill('short');
    await pw.last().fill('short');
    await page.getByRole('button', { name: 'Restore wallet' }).click();
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible({
      timeout: 5_000,
    });
    await snap(page, '03-restore-password-too-short');
  });

  test('restore-password-mismatch', async ({ page }) => {
    const { alice } = readAccounts();
    await enterImportFlow(page);
    await page.locator('textarea').fill(alice.mnemonic.join(' '));
    await page.getByText('Continue', { exact: true }).click();
    const pw = page.locator('input[type="password"]');
    await pw.first().fill(PASSWORD);
    await pw.last().fill('DifferentPass456!');
    await page.getByRole('button', { name: 'Restore wallet' }).click();
    await expect(page.getByText('Passwords do not match')).toBeVisible({ timeout: 5_000 });
    await snap(page, '03-restore-password-mismatch');
  });

  // The `restoring` baseline from the plan was dropped for the same
  // reason as `creating` in 02-create-seed: SeedImportFlow's `restore`
  // callback runs WASM + IDB encrypt in under 50 ms and `setAuth`
  // swaps `Home` to `WalletScreen` before any DOM screenshot can land
  // on the "Restoring…" disabled-button state. `wallet-after-restore`
  // covers the transition functionally. Plan totals updated in
  // e2e/README.md § 8.13.

  test('wallet-after-restore', async ({ page }) => {
    // Give the test 60 s — the restore flow itself takes 20-25 s on
    // the DEV server (WASM derivation + IDB encrypt + first /api/balance
    // round-trip) and the snap helper's networkidle wait races against
    // the 5 s wallet balance-polling tick, so the default 30 s budget
    // is tight even on a quiet day.
    test.setTimeout(60_000);
    const { alice } = readAccounts();
    await enterImportFlow(page);
    await page.locator('textarea').fill(alice.mnemonic.join(' '));
    await page.getByText('Continue', { exact: true }).click();
    const pw = page.locator('input[type="password"]');
    await pw.first().fill(PASSWORD);
    await pw.last().fill(PASSWORD);
    await page.getByRole('button', { name: 'Restore wallet' }).click();
    await expect(page.locator('text=/[0-9a-f]{8}@zkcoins\\.app/').first()).toBeVisible({
      timeout: 30_000,
    });
    await snap(page, '03-wallet-after-restore');
  });

  test('back-from-input (no shot)', async ({ page }) => {
    await enterImportFlow(page);
    // StepHeader back is the only `<button>` before the textarea.
    await page.locator('button').first().click();
    await expect(page.getByText('Welcome to zkCoins')).toBeVisible({ timeout: 10_000 });
  });
});
