/**
 * Spec 18 — Create coin (`/create`)
 *
 * The neutral multi-asset model has no faucet: a wallet funds itself by
 * minting its own asset through this form (creator-signed two-phase mint —
 * `POST /api/jobs/mint` → poll `awaiting_signature` → commit → poll
 * `completed`, see `src/lib/api/client.ts::createCoin`). This spec
 * baselines every form state the user can reach:
 *
 *   - initial / empty    (desktop + mobile) — submit disabled
 *   - filled             — all three fields valid, submit enabled
 *   - in-progress        — "Creating coin…" (admit route delayed so the
 *                          button parks in its `creating` state)
 *   - error              — admit route returns a structured 4xx `{error}`
 *   - success            — a REAL mint through the live node (Alice has an
 *                          xpriv); the success screen renders deterministic
 *                          chrome ("Coin created" + Done), amount/name are
 *                          stable because the spec chooses them.
 *
 * `/create` renders with `showNav={false}` (no BottomNav). Only `creating`
 * and `success`/`error` states carry per-run-volatile content — the form
 * fields are deterministic because the spec types fixed values, and the
 * mocked states never reach the on-chain layer.
 */

import { expect, test, type Page } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { clearWalletState, createSeedWallet } from './_helpers/wallet';
import { snap, setViewport } from './_helpers/screenshot';

// The zkCoins PWA service worker can pass `/api/jobs/*` traffic before
// `page.route()` sees it — block it so the route mocks are the only
// handlers for the admit route (same rationale as spec 13).
test.use({ serviceWorkers: 'block' });

/** Log Alice in and open `/create`. */
async function aliceGoToCreate(page: Page): Promise<void> {
  await aliceLogin(page);
  await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('create-coin-btn').click();
  await expect(page.getByTestId('create-heading')).toBeVisible({ timeout: 10_000 });
}

/** Type fixed, deterministic values into the three create-coin fields. */
async function fillForm(page: Page): Promise<void> {
  await page.getByTestId('create-name-input').fill('Test Coin');
  await page.getByTestId('create-decimals-input').fill('0');
  await page.getByTestId('create-amount-input').fill('1000');
}

test.describe('Create coin', () => {
  test('Visual Regression — create-empty-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await aliceGoToCreate(page);
    // Submit is disabled until name + amount are non-empty.
    await expect(page.getByTestId('create-submit-btn')).toBeDisabled();
    await snap(page, '18-create-empty-desktop');
  });

  test('Visual Regression — create-empty-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceGoToCreate(page);
    await expect(page.getByTestId('create-submit-btn')).toBeDisabled();
    await snap(page, '18-create-empty-mobile', { fullPage: true });
  });

  test('Visual Regression — create-filled', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceGoToCreate(page);
    await fillForm(page);
    // All fields valid → submit enabled.
    await expect(page.getByTestId('create-submit-btn')).toBeEnabled();
    await snap(page, '18-create-filled', { fullPage: true });
  });

  test('Visual Regression — create-in-progress', async ({ page }) => {
    await setViewport(page, 'mobile');
    // Delay the admit route so the button parks in its "Creating coin…"
    // disabled state long enough to capture (it never resolves within the
    // shot window — the snapshot is taken while the request is in flight).
    await page.context().route(/\/api\/jobs\/mint$/, async (route) => {
      await new Promise((r) => setTimeout(r, 5_000));
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ job_id: 'e2e-pending', status: 'queued' }),
      });
    });
    await aliceGoToCreate(page);
    await fillForm(page);
    await page.getByTestId('create-submit-btn').click();
    // The submit button swaps to its "creating" label and disables. Assert the
    // disabled state (locale-independent) rather than the localized label — the
    // form fields are filled, so `disabled` here can only mean `creating`.
    await expect(page.getByTestId('create-submit-btn')).toBeDisabled();
    await snap(page, '18-create-in-progress', { fullPage: true });
  });

  test('Visual Regression — create-error', async ({ page }) => {
    await setViewport(page, 'mobile');
    // Admit route rejects with a structured 4xx `{error}` — exactly the
    // envelope the node emits when it refuses a mint before enqueueing.
    await page.context().route(/\/api\/jobs\/mint$/, (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid mint request' }),
      }),
    );
    await aliceGoToCreate(page);
    await fillForm(page);
    await page.getByTestId('create-submit-btn').click();
    await expect(page.getByTestId('create-error')).toBeVisible({ timeout: 30_000 });
    // The button has settled back to its idle state (creating === false) — with
    // the fields still filled it is enabled again. Assert the state, not the
    // localized label.
    await expect(page.getByTestId('create-submit-btn')).toBeEnabled();
    await snap(page, '18-create-error', { fullPage: true });
  });

  test('Visual Regression — create-success', async ({ page }) => {
    // A real mint through the live node: proof gen + commit + poll can take
    // well over the 30 s default on Mutinynet.
    test.setTimeout(180_000);
    await setViewport(page, 'mobile');
    // Mint into a FRESH throwaway wallet, not Alice/Bob: a real create-coin
    // mutates the wallet's server-truth portfolio, and Alice (funded) + Bob
    // (empty) are shared fixtures whose asset counts other specs (06/19/20/21)
    // snapshot. Using a per-test wallet keeps those goldens deterministic
    // under `fullyParallel`.
    await clearWalletState(page);
    await createSeedWallet(page);
    await expect(page.getByTestId('create-coin-btn')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('create-coin-btn').click();
    await expect(page.getByTestId('create-heading')).toBeVisible({ timeout: 10_000 });
    // Deterministic name so the success body ("{amount} {name} minted…")
    // is stable across runs.
    await page.getByTestId('create-name-input').fill('E2EGold');
    await page.getByTestId('create-decimals-input').fill('0');
    await page.getByTestId('create-amount-input').fill('1000');
    await page.getByTestId('create-submit-btn').click();
    // While the two-phase mint runs, the submit button parks in its disabled
    // "creating" state and the lifecycle surfaces a phase label
    // (`onPhase` → `create-phase`) that tracks the job through proving →
    // awaiting_signature → broadcasting. Assert it renders during the flow;
    // it is cleared once the success surface lands.
    await expect(page.getByTestId('create-phase')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('create-success-heading')).toBeVisible({ timeout: 170_000 });
    await expect(page.getByTestId('create-done-btn')).toBeVisible();
    await snap(page, '18-create-success', { fullPage: true });
  });
});
