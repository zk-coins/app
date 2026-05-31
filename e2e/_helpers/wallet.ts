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
 *
 * Locators: everything that drives or asserts the UI uses `data-testid`
 * via `page.getByTestId(...)`. Text-based locators were removed in the
 * i18n-readiness pass — once we ship translations, the testids stay
 * stable while the visible copy changes.
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
  // Wait only until the document hydrates. We don't wait for
  // `networkidle` (500 ms of zero traffic) because the boot path now
  // fires a fire-and-forget `/api/info` capabilities fetch and the
  // service worker (public/sw.js) does stale-while-revalidate for
  // every cached asset — on CI those background fetches can keep the
  // 500 ms window from ever closing, deadlocking globalSetup. The
  // caller's next step is a testid-based locator assertion, which
  // is the real readiness signal we want anyway. Same rationale as
  // `snap()` in `screenshot.ts`.
  await page.reload({ waitUntil: 'domcontentloaded' });
}

/**
 * Walk the SeedFlow from Welcome to a fully-loaded wallet, capturing the
 * generated mnemonic before the user "confirms it down".
 *
 * Returns the 12 BIP-39 words and the full 64-hex address read off the
 * copy-address button's `title` attribute (the visible chip is truncated
 * to `{8hex}@zkcoins.app`).
 *
 * Assumes a blank-slate state (no wallet in IDB). Caller must `clearWalletState`
 * first.
 */
export async function createSeedWallet(
  page: Page,
  password: string = DEFAULT_PASSWORD,
): Promise<{ mnemonic: string[]; address: string }> {
  await page.goto('/');

  await page.getByTestId('onboarding-create-btn').click();
  // Skip the PasskeyFlow intro if present. With FEATURES.PASSKEY off
  // (the default in DEV + PRD per issue #30), the intro doesn't exist
  // and we land directly on the seed flow. With FEATURES.PASSKEY on
  // (local-only via .env.local), the intro is there and needs an
  // explicit click. Tolerate both — the existence of the seed-flow is
  // the actual success condition asserted right after.
  const passkeySkip = page.getByTestId('passkey-other-options-btn');
  if (await passkeySkip.isVisible({ timeout: 1500 }).catch(() => false)) {
    await passkeySkip.click();
  }

  await expect(page.getByTestId('seed-flow')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('seed-reveal-btn').click();

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

  await page.getByTestId('seed-written-btn').click();
  await page.getByTestId('seed-confirm-btn').click();

  await page.getByTestId('seed-password-input').fill(password);
  await page.getByTestId('seed-password-confirm-input').fill(password);
  await page.getByTestId('seed-create-btn').click();

  // The full 64-hex address is exposed via the `title` attribute on the
  // copy-address button in WalletScreen (the visible text is the truncated
  // `{8hex}@zkcoins.app` chip). Wait for the chip to render, then read the
  // title from the surrounding `<button>` for the canonical form.
  const chip = page.locator(`text=${ZK_ADDRESS_RE}`).first();
  await expect(chip).toBeVisible({ timeout: 30_000 });
  const copyButton = page.locator(`button:has-text("@zkcoins.app")`).first();
  const address = (await copyButton.getAttribute('title'))?.trim() ?? '';
  if (!address || address.length < 64) {
    throw new Error(
      `createSeedWallet: failed to read full address from chip title, got "${address}"`,
    );
  }

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
  await page.getByTestId('onboarding-restore-btn').click();

  const textarea = page.getByTestId('seed-import-textarea');
  await expect(textarea).toBeVisible({ timeout: 10_000 });
  await textarea.fill(mnemonic.join(' '));
  await page.getByTestId('seed-import-continue-btn').click();

  await expect(page.getByTestId('seed-import-password-stage')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('seed-import-password-input').fill(password);
  await page.getByTestId('seed-import-password-confirm-input').fill(password);
  await page.getByTestId('seed-import-submit-btn').click();

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
  await expect(page.getByTestId('unlock-heading')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('unlock-password-input').fill(password);
  await page.getByTestId('unlock-submit-btn').click();
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
  await page.getByTestId('settings-disconnect-btn').click();
  // After disconnect the app routes back to Welcome — the create-wallet
  // CTA is the most stable anchor that the onboarding screen is rendered.
  await expect(page.getByTestId('onboarding-create-btn')).toBeVisible({ timeout: 10_000 });
}

/**
 * Block until WalletScreen's `useEffect(api.info, …)` has resolved and
 * `networkName` is populated in the zustand store. Polling the store
 * directly (rather than the DOM badge) eliminates the in-app-navigation
 * race that previously required +30 s DOM-visibility timeouts: as soon
 * as `api.info()` returns, any subsequent navigation that gates UI on
 * `networkName !== ''` is deterministic — the badge renders on first
 * paint of the target route.
 *
 * The store is exposed on `window.__useNetworkStore` by
 * `src/stores/network.ts` precisely for this purpose.
 */
type NetworkStoreShim = {
  getState: () => { networkName: string };
};
export async function waitForNetworkInfo(page: Page, timeout = 30_000): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = window as unknown as { __useNetworkStore?: NetworkStoreShim };
          return w.__useNetworkStore?.getState().networkName ?? '';
        }),
      { timeout },
    )
    .not.toBe('');
}

/**
 * Block until WalletScreen's first `/api/balance` tick has resolved.
 * Polls the `data-loading` marker on `balance-amount-usd`, which is
 * `true` while `balance === null` (post-mount loading) and absent once
 * the first tick lands — regardless of the value (zero or funded).
 *
 * Use this in test setup instead of `wallet-empty-banner` visibility:
 * the banner only renders for `balance === 0` and is genuinely absent
 * when the wallet is funded, so banner-absence is not a reliable
 * "loaded" signal. The `data-loading` attribute is.
 */
export async function waitForBalanceLoaded(page: Page, timeout = 60_000): Promise<void> {
  await expect(page.getByTestId('balance-amount-usd')).not.toHaveAttribute('data-loading', 'true', {
    timeout,
  });
}
