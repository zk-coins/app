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

import { accountFromMnemonic } from './keys';

export const DEFAULT_PASSWORD = 'TestPass123!';

/**
 * Wipe localStorage + IndexedDB for the current origin. Wipe without an
 * open app connection: `goto('/')` would open React/IDB and leave
 * `deleteDatabase` blocked. Hit a same-origin static asset first, await
 * every delete, then enter the app. Run this in `beforeEach` of any
 * onboarding spec.
 */
export async function clearWalletState(page: Page): Promise<void> {
  // Static asset — same origin, no React, no IDB connection from the app.
  await page.goto('/manifest.json');
  await page.evaluate(async () => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('zkcoins'))
      .forEach((k) => localStorage.removeItem(k));
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs.map(
        (db) =>
          new Promise<void>((resolve, reject) => {
            if (!db.name) {
              resolve();
              return;
            }
            const req = indexedDB.deleteDatabase(db.name);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error ?? new Error(`deleteDatabase failed: ${db.name}`));
            req.onblocked = () => reject(new Error(`deleteDatabase blocked: ${db.name}`));
          }),
      ),
    );
  });
  // Enter the app only after the wipe succeeded. Wait for document
  // hydrate only — not `networkidle` (boot fires fire-and-forget
  // `/v1/info` + SW revalidation that can keep the 500 ms window open
  // on CI). Callers assert readiness via testid locators.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

/**
 * Walk the SeedFlow from Welcome to a fully-loaded wallet, capturing the
 * generated mnemonic before the user "confirms it down".
 *
 * Ready-marker is `create-coin-btn` (wallet shell settled). Address is
 * derived via `accountFromMnemonic` from the captured seed — not from the
 * address-chip title (chip may be empty until a username is claimed).
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

  await expect(page.getByTestId('create-coin-btn')).toBeVisible({ timeout: 30_000 });
  const address = accountFromMnemonic(mnemonic.join(' ')).address;
  return { mnemonic, address };
}

/**
 * Drive the SeedImportFlow with a known mnemonic. Used by `aliceLogin` /
 * `bobLogin` in `fixtures.ts` to log a worker in as one of the run's
 * fixture accounts.
 *
 * Ready-marker is `create-coin-btn`. Address via `accountFromMnemonic`.
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

  await expect(page.getByTestId('create-coin-btn')).toBeVisible({ timeout: 30_000 });
  const address = accountFromMnemonic(mnemonic.join(' ')).address;
  return { address };
}

/**
 * Drive the UnlockScreen. Assumes the encrypted wallet is already in IDB
 * and `Home` is rendering `<UnlockScreen authMethod="seed" />`.
 *
 * Ready-marker is `create-coin-btn` after unlock.
 */
export async function unlockWithPassword(
  page: Page,
  password: string = DEFAULT_PASSWORD,
): Promise<void> {
  await expect(page.getByTestId('unlock-heading')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('unlock-password-input').fill(password);
  await page.getByTestId('unlock-submit-btn').click();
  await expect(page.getByTestId('create-coin-btn')).toBeVisible({ timeout: 15_000 });
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
 * Block until WalletScreen/`useCapabilities.fetch` has resolved and
 * `network` is populated in the zustand Network store. Polling the store
 * directly (rather than the DOM badge) eliminates the in-app-navigation
 * race that previously required +30 s DOM-visibility timeouts: as soon
 * as capabilities/info lands, any subsequent navigation that gates UI on
 * `network !== ''` is deterministic — the badge renders on first paint
 * of the target route.
 *
 * The store is exposed on `window.__useNetworkStore` by
 * `src/stores/network.ts` precisely for this purpose.
 */
type NetworkStoreShim = {
  getState: () => { network: string };
};
export async function waitForNetworkInfo(page: Page, timeout = 30_000): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = window as unknown as { __useNetworkStore?: NetworkStoreShim };
          return w.__useNetworkStore?.getState().network ?? '';
        }),
      { timeout },
    )
    .not.toBe('');
}

/**
 * Block until WalletScreen's first balance/portfolio tick has resolved.
 * Capability-adaptive, matching the dual-mode home screen:
 *
 *   - Single-asset surface (`multi_asset:false`): the USD/BTC hero carries
 *     `data-loading="true"` until the first `/v1/balance` tick lands,
 *     regardless of value (funded or zero). Absence of that marker is the
 *     settled signal — `asset-list` / `wallet-empty-banner` are NOT rendered
 *     for a funded single-asset wallet, so they can't gate this leg.
 *   - Multi-asset surface (`multi_asset:true`): the home screen renders the
 *     `asset-list` (funded) or `wallet-empty-banner` (empty) once the
 *     portfolio loads.
 *
 * Polls for whichever surface is present so the same helper works on both
 * the FALSE and TRUE E2E legs.
 */
export async function waitForBalanceLoaded(page: Page, timeout = 60_000): Promise<void> {
  await expect
    .poll(
      async () => {
        // Honest "not available in this build" surfaces (current read path).
        const unavailable = await page
          .getByTestId('portfolio-unavailable-banner')
          .or(page.getByTestId('portfolio-error-banner'))
          .or(page.getByTestId('balance-unavailable-banner'))
          .isVisible()
          .catch(() => false);
        if (unavailable) return true;

        // Single-asset hero settled (data-loading attribute gone)?
        const heroCount = await page.getByTestId('balance-amount-usd').count();
        if (heroCount > 0) {
          const loading = await page.getByTestId('balance-amount-usd').getAttribute('data-loading');
          if (loading !== 'true') return true;
        }
        // Multi-asset portfolio settled (list, empty, or unavailable)?
        const portfolioVisible = await page
          .getByTestId('asset-list')
          .or(page.getByTestId('wallet-empty-banner'))
          .or(page.getByTestId('portfolio-unavailable-banner'))
          .isVisible()
          .catch(() => false);
        return portfolioVisible;
      },
      { timeout },
    )
    .toBe(true);
}
