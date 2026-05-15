/**
 * UI-driven wallet helpers. Every function in this file drives the same
 * buttons a real user would click — no IndexedDB or store back-doors.
 *
 * Two reasons for the UI-driven approach:
 *   1. Determinism: the helpers exercise the same code path the app uses,
 *      so a regression in the onboarding logic also breaks the helpers.
 *   2. No app-side test-only hooks: we don't have to expose any store
 *      internals on `window` to make the tests work.
 *
 * The trade-off is speed — restoring Alice in a test takes ~3 s. Fixtures
 * (`e2e/_helpers/fixtures.ts`) cache Alice + Bob across the run so we pay
 * the UI cost once per test, not once per spec.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const DEFAULT_PASSWORD = 'TestPass123!';

/** Address chip format the wallet renders: `{first8hex}@zkcoins.app`. */
const ZK_ADDRESS_RE = /[0-9a-f]{8}@zkcoins\.app/;

/**
 * Wipe localStorage + IndexedDB for the current origin. Run this in
 * `beforeEach` of any onboarding spec.
 */
export async function clearWalletState(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('zkcoins'))
      .forEach((k) => localStorage.removeItem(k));
    const dbs = await indexedDB.databases().catch(() => []);
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
  });
  await page.reload({ waitUntil: 'networkidle' });
}

/**
 * Walk the SeedFlow from Welcome to a fully-loaded wallet, capturing the
 * generated mnemonic before the user "confirms it down".
 *
 * Returns the 12 BIP-39 words and the `{8hex}@zkcoins.app` chip text so
 * the caller can persist them as a fixture.
 *
 * Assumes a blank-slate state (no wallet in IDB). Caller must `clearWalletState`
 * first.
 */
export async function createSeedWallet(
  page: Page,
  password: string = DEFAULT_PASSWORD,
): Promise<{ mnemonic: string[]; address: string }> {
  await page.goto('/');

  await page.getByText('CREATE WALLET').click();
  // DEV bundle: an extra PasskeyFlow intro screen sits between the
  // welcome and SeedFlow. Skip it. (See e2e/README.md § 8.0 (a).)
  await page.getByText('OTHER LOGIN OPTIONS').click();

  await expect(page.getByText('Your seed phrase')).toBeVisible({ timeout: 15_000 });
  await page.getByText('Tap to reveal').click();

  // Capture the mnemonic from the revealed grid. SeedFlow renders 12 cells
  // in a `grid-cols-3` container; each cell has a number span and a word
  // span. Grab the word (second span) from each.
  const mnemonic = await page.locator('[data-testid="seed-grid"] > div').evaluateAll((cells) =>
    cells.map((cell) => {
      const spans = cell.querySelectorAll('span');
      return spans[1]?.textContent?.trim() ?? '';
    }),
  );
  if (mnemonic.length !== 12 || mnemonic.some((w) => !w)) {
    throw new Error(
      `createSeedWallet: failed to read 12 mnemonic words, got ${JSON.stringify(mnemonic)}`,
    );
  }

  await page.getByText("I've written it down").click();
  await page.getByText('Continue').click();

  const pwInputs = page.locator('input[type="password"]');
  await pwInputs.first().fill(password);
  await pwInputs.last().fill(password);
  await page.getByText('Create wallet').click();

  const chip = page.locator(`text=${ZK_ADDRESS_RE}`).first();
  await expect(chip).toBeVisible({ timeout: 30_000 });
  const address = (await chip.textContent())?.trim() ?? '';
  if (!address) throw new Error('createSeedWallet: wallet rendered but address chip was empty');

  return { mnemonic, address };
}

/**
 * Drive the SeedImportFlow with a known mnemonic. Used by `aliceLogin` /
 * `bobLogin` in `fixtures.ts` to log a worker in as one of the run's
 * fixture accounts.
 *
 * Assumes a blank-slate state.
 */
export async function restoreSeedWallet(
  page: Page,
  mnemonic: string[],
  password: string = DEFAULT_PASSWORD,
): Promise<{ address: string }> {
  await page.goto('/');
  await page.getByText('Restore existing wallet').click();

  await expect(page.getByText('Restore wallet')).toBeVisible({ timeout: 10_000 });
  await page.locator('textarea').fill(mnemonic.join(' '));
  await page.getByText('Continue').click();

  await expect(page.getByText('Set an encryption password')).toBeVisible({ timeout: 10_000 });
  const pwInputs = page.locator('input[type="password"]');
  await pwInputs.first().fill(password);
  await pwInputs.last().fill(password);
  await page.getByText('Restore wallet').click();

  const chip = page.locator(`text=${ZK_ADDRESS_RE}`).first();
  await expect(chip).toBeVisible({ timeout: 30_000 });
  const address = (await chip.textContent())?.trim() ?? '';
  return { address };
}

/**
 * Drive the UnlockScreen. Assumes the encrypted wallet is already in IDB
 * and `Home` is rendering `<UnlockScreen authMethod="seed" />`.
 */
export async function unlockWithPassword(
  page: Page,
  password: string = DEFAULT_PASSWORD,
): Promise<void> {
  await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 10_000 });
  await page.locator('input[type="password"]').fill(password);
  await page.getByText('Unlock', { exact: true }).click();
  await expect(page.locator(`text=${ZK_ADDRESS_RE}`).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Drive Settings → Disconnect Wallet → accept the `window.confirm` dialog.
 *
 * The browser-native `confirm()` cannot be screenshotted directly; tests
 * that want to baseline the dialog must register their own `page.on('dialog', …)`
 * before clicking. This helper just accepts.
 */
export async function disconnect(page: Page): Promise<void> {
  await page.goto('/settings');
  page.once('dialog', (d) => d.accept());
  await page.getByText('Disconnect Wallet').click();
  await expect(page.getByText('Welcome to zkCoins')).toBeVisible({ timeout: 10_000 });
}
