/**
 * Spec 07 — Send (2-phase), multi-asset.
 *
 * Covers § 8.7 of e2e/README.md. The full Send pipeline plus every error
 * branch. Since the single-asset → multi-asset migration the Send form
 * leads with a per-asset picker (`send-asset-select`), an "Available"
 * readout for the chosen asset, and an amount field denominated in that
 * asset's units. This spec mirrors that flow (consistent with the newer
 * `20-send-asset`) while keeping every error/confirm/success branch:
 *
 *   - send-default            — picker hydrated, submit disabled (no inputs)
 *   - send-no-funds-banner    — a held asset with a zero balance shows the
 *                               no-funds banner (route-mocked: the live
 *                               fixtures never produce a zero-balance held
 *                               asset)
 *   - recipient-valid-hex     — recipient filled, amount empty → disabled
 *   - amount-typed            — valid amount → enabled
 *   - amount-set-max-clicked  — "Max" fills the available balance
 *   - amount-invalid-text     — `abc` → "Invalid amount"
 *   - amount-insufficient     — > balance → "Insufficient balance"
 *   - confirm-dialog d/m      — the confirm card, desktop + mobile
 *   - confirm-cancel-back     — Cancel returns to the form
 *   - send-success            — one REAL send through `/api/jobs/send`
 *
 * Alice's fixture asset has 0 decimals and a large supply, so amounts are
 * whole units: `1` is a valid send, `999999999` is over balance.
 *
 * Locators: testid-based. The asset select + "Available" readout carry the
 * per-run asset name/balance, so they're masked in every golden.
 */

import { expect, test, type Page } from '@playwright/test';
import { readAccounts, aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

/** Volatile cells masked in every send golden. The asset select option text
 *  and the "Available" readout both carry the per-run asset name + balance. */
function sendMasks(page: Page) {
  return [page.getByTestId('send-asset-select'), page.getByTestId('send-available')];
}

/** Navigate Wallet → /send via the in-app Send link (client-side nav), then
 *  wait for the per-asset picker to hydrate from the portfolio tick. */
async function goToSend(page: Page): Promise<void> {
  await page.getByTestId('wallet-send-btn').click();
  await expect(page.getByTestId('send-heading')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('send-asset-select')).toBeVisible({ timeout: 30_000 });
}

/** Common Alice setup: log in (waits for portfolio), then nav to /send. */
async function aliceGoToSend(page: Page): Promise<void> {
  await aliceLogin(page);
  await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
  await goToSend(page);
}

test.describe('Send', () => {
  test('send-default', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceGoToSend(page);
    // Available balance for the auto-selected asset has resolved (the
    // `data-loading` marker flips false once the portfolio tick lands).
    await expect(page.getByTestId('send-available')).not.toHaveAttribute('data-loading', 'true', {
      timeout: 10_000,
    });
    await expect(page.getByTestId('send-submit-btn')).toBeDisabled();
    await snap(page, '07-send-default', { mask: sendMasks(page) });
  });

  test('send-no-funds-banner', async ({ page }) => {
    await setViewport(page, 'mobile');
    // The no-funds banner shows when the SELECTED asset's balance is exactly
    // 0. The live fixtures never produce a held-but-empty asset (Alice is
    // funded, Bob holds nothing), so drive Alice — whose send button is an
    // enabled client-side Link — and intercept her portfolio to return a
    // single zero-balance asset. Clicking her send button is a genuine
    // client-side nav that preserves the in-memory account; the send page's
    // own portfolio tick then resolves to the zero-balance asset → banner.
    await aliceLogin(page);
    await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
    await page.context().route(/\/api\/balance\/[^/?]+$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          address: 'e2e',
          assets: [
            { asset_id: 'a'.repeat(64), name: 'E2EGold', decimals: 0, balance: 0, num_sends: 0 },
          ],
        }),
      }),
    );
    await goToSend(page);
    await expect(page.getByTestId('send-no-funds-banner')).toBeVisible({ timeout: 30_000 });
    await snap(page, '07-send-no-funds-banner', { mask: sendMasks(page) });
  });

  test('recipient-valid-hex', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    // Amount still empty → button still disabled.
    await expect(page.getByTestId('send-submit-btn')).toBeDisabled();
    await snap(page, '07-recipient-valid-hex', {
      mask: [page.getByTestId('send-recipient-input'), ...sendMasks(page)],
    });
  });

  test('amount-typed', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('1');
    await expect(page.getByTestId('send-submit-btn')).toBeEnabled();
    await snap(page, '07-amount-typed', {
      mask: [page.getByTestId('send-recipient-input'), ...sendMasks(page)],
    });
  });

  test('amount-set-max-clicked', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-setmax-btn').click();
    await snap(page, '07-amount-set-max-clicked', {
      mask: [
        page.getByTestId('send-recipient-input'),
        page.getByTestId('send-amount-input'),
        ...sendMasks(page),
      ],
    });
  });

  test('amount-invalid-text', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('abc');
    await page.getByTestId('send-submit-btn').click();
    await expect(page.getByTestId('send-error')).toBeVisible({ timeout: 5_000 });
    // i18n-todo: discriminate invalid vs insufficient via data-error-kind.
    // The e2e build bakes `en`, so this is the English `send.errInvalidAmount`.
    await expect(page.getByTestId('send-error')).toHaveText(/Invalid amount/);
    await snap(page, '07-amount-invalid-text', {
      mask: [page.getByTestId('send-recipient-input'), ...sendMasks(page)],
    });
  });

  test('amount-insufficient', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('999999999');
    await page.getByTestId('send-submit-btn').click();
    await expect(page.getByTestId('send-error')).toBeVisible({ timeout: 5_000 });
    // i18n-todo: discriminate invalid vs insufficient via data-error-kind.
    // The e2e build bakes `en`, so this is the English `send.errInsufficient`.
    await expect(page.getByTestId('send-error')).toHaveText(/Insufficient balance/);
    await snap(page, '07-amount-insufficient', {
      mask: [page.getByTestId('send-recipient-input'), ...sendMasks(page)],
    });
  });

  test('confirm-dialog-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('1');
    await page.getByTestId('send-submit-btn').click();
    await expect(page.getByTestId('send-confirm-card')).toBeVisible({ timeout: 5_000 });
    await snap(page, '07-confirm-dialog-desktop', {
      mask: [
        page.getByTestId('send-recipient-input'),
        // The confirm card echoes the volatile asset name + recipient hex.
        page.getByTestId('send-confirm-card').locator('p').first(),
        page.getByTestId('send-confirm-card').locator('p.mono'),
        ...sendMasks(page),
      ],
    });
  });

  test('confirm-dialog-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('1');
    await page.getByTestId('send-submit-btn').click();
    await expect(page.getByTestId('send-confirm-card')).toBeVisible({ timeout: 5_000 });
    await snap(page, '07-confirm-dialog-mobile', {
      mask: [
        page.getByTestId('send-recipient-input'),
        page.getByTestId('send-confirm-card').locator('p').first(),
        page.getByTestId('send-confirm-card').locator('p.mono'),
        ...sendMasks(page),
      ],
    });
  });

  test('confirm-cancel-back', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('1');
    await page.getByTestId('send-submit-btn').click();
    await page.getByTestId('send-cancel-btn').click();
    await expect(page.getByTestId('send-submit-btn')).toBeVisible({ timeout: 5_000 });
    await snap(page, '07-confirm-cancel-back', {
      mask: [page.getByTestId('send-recipient-input'), ...sendMasks(page)],
    });
  });

  // Dropped: the "Creating proof…" state is unreachable visually.
  // SendPage::send() runs `setConfirming(false)` BEFORE `setSending(true)`,
  // so React unmounts the entire confirm card (where the button label
  // lives) on the same tick the click fires. The user never sees that
  // text, the spec can't snapshot it, the transition is functionally
  // covered by `send-success`. § 8.13 totals updated.

  test('send-success', async ({ page }) => {
    // The 2-phase Send pipeline does: signed `/api/jobs/send` (ZK proof
    // generation server-side) → commit → poll-to-completed → success
    // heading. On the local multi-asset node the proof + commit for one
    // send lands in well under the cap below, but Mutinynet block jitter
    // and the node's single proof-gen pipeline mean a parallel suite can
    // starve this one send for a while. The structural fix lives in the
    // runner: `--grep "send-success" --workers=1` runs this test on its
    // own so it gets exclusive node bandwidth. A 6 min cap leaves ample
    // headroom for the slow tail without masking a genuine regression.
    test.setTimeout(360_000);
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('1');
    await page.getByTestId('send-submit-btn').click();
    await page.getByTestId('send-confirm-btn').click();
    // Race the success heading against the inline error banner so a
    // server-side failure surfaces with the real error message instead of
    // "element never appeared after N s". Tag which branch won, then only
    // act on that branch (resolving the error locator's textContent
    // unconditionally would block until the test cap, since the error
    // testid never appears on the success page).
    const heading = page.getByTestId('send-success-heading');
    const error = page.getByTestId('send-error');
    const winner = await Promise.race([
      heading.waitFor({ state: 'visible', timeout: 300_000 }).then(() => 'heading' as const),
      error.waitFor({ state: 'visible', timeout: 300_000 }).then(() => 'error' as const),
    ]);
    if (winner === 'error') {
      const errorText = (await error.textContent()) ?? '';
      throw new Error(`send-success: server returned an error: ${errorText}`);
    }
    await expect(heading).toBeVisible();
    // The success line echoes the volatile per-run asset name + amount; mask
    // it so the golden checks the success layout, not the values.
    await snap(page, '07-send-success', {
      mask: [page.getByTestId('send-success-amount')],
    });
  });

  // Dropped: the err-banner state on /send is unreachable for the
  // same reason as `sending-creating-proof` above — once the user
  // clicks Confirm Send, send() runs `setConfirming(false)` first,
  // which unmounts the confirm card and re-renders the bare Send
  // privately button. By the time the route abort fires, the page
  // looks indistinguishable from the pre-send state plus a small
  // error line. The render is flaky to capture and adds little
  // signal over `send-success`. § 8.13 totals updated.

  // Dropped: `recovering-banner` — the localStorage in-flight-commit
  // crash-recovery path was removed with the Jobs-API migration. § 8.13
  // totals updated.
});
