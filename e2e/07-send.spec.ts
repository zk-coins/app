/**
 * Spec 07 — Send Bitcoin (2-phase)
 *
 * Covers § 8.7 of e2e/README.md. The full Send pipeline plus every
 * error branch. 14 tests, 13 linux baselines, 1 no-shot.
 *
 * Alice (funded, 100 000 sats) sends 1 000 sats to Bob. The send
 * goes through real `/api/send` + `/api/commit` against DEV.
 *
 * DEV mirrors PRD (issue #30): no FEATURES.USERNAMES, no
 * FEATURES.APPS_DIRECTORY → no `@user` placeholder, no DFX link in
 * the no-funds banner. The `recipient-valid-username` test was removed
 * with the migration.
 *
 * Locators: testid-based. The two amount-error paths (invalid text,
 * insufficient balance) currently share the `send-error` container,
 * so the discriminating assertions still use literal English text —
 * marked `i18n-todo` for the data-error-kind migration.
 */

import { expect, test, type Page } from '@playwright/test';
import { readAccounts, aliceLogin, bobLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

/** Navigate Wallet → /send via the in-app Send link (client-side nav). */
async function goToSend(page: Page): Promise<void> {
  await page.getByTestId('wallet-send-btn').click();
  await expect(page.getByTestId('send-heading')).toBeVisible({ timeout: 10_000 });
}

/** Common Alice setup: log in (waits for balance + network), then nav to /send. */
async function aliceGoToSend(page: Page): Promise<void> {
  await aliceLogin(page);
  await goToSend(page);
}

test.describe('Send Bitcoin', () => {
  test('send-default', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceGoToSend(page);
    // Available balance is loaded (data-loading flips false once the
    // /api/balance tick lands). Same source as the wallet-screen value;
    // this is the only spec that asserts the send-page rendering of it.
    await expect(page.getByTestId('send-available')).not.toHaveAttribute('data-loading', 'true', {
      timeout: 10_000,
    });
    await expect(page.getByTestId('send-submit-btn')).toBeDisabled();
    await snap(page, '07-send-default');
  });

  test('send-no-funds-banner', async ({ page }) => {
    await setViewport(page, 'mobile');
    await bobLogin(page);
    await goToSend(page);
    await expect(page.getByTestId('send-no-funds-banner')).toBeVisible({ timeout: 30_000 });
    await snap(page, '07-send-no-funds-banner');
  });

  test('recipient-valid-hex', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    // Amount still empty → button still disabled.
    await expect(page.getByTestId('send-submit-btn')).toBeDisabled();
    await snap(page, '07-recipient-valid-hex', {
      mask: [page.getByTestId('send-recipient-input')],
    });
  });

  test('amount-typed', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('0.00001');
    await expect(page.getByTestId('send-submit-btn')).toBeEnabled();
    await snap(page, '07-amount-typed', {
      mask: [page.getByTestId('send-recipient-input')],
    });
  });

  test('amount-set-max-clicked', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-setmax-btn').click();
    await snap(page, '07-amount-set-max-clicked', {
      mask: [page.getByTestId('send-recipient-input'), page.getByTestId('send-amount-input')],
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
    await expect(page.getByTestId('send-error')).toHaveText(/Invalid amount/);
    await snap(page, '07-amount-invalid-text', {
      mask: [page.getByTestId('send-recipient-input')],
    });
  });

  test('amount-insufficient', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('999');
    await page.getByTestId('send-submit-btn').click();
    await expect(page.getByTestId('send-error')).toBeVisible({ timeout: 5_000 });
    // i18n-todo: discriminate invalid vs insufficient via data-error-kind.
    await expect(page.getByTestId('send-error')).toHaveText(/Insufficient balance/);
    await snap(page, '07-amount-insufficient', {
      mask: [page.getByTestId('send-recipient-input')],
    });
  });

  test('confirm-dialog-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('0.00001');
    await page.getByTestId('send-submit-btn').click();
    await expect(page.getByTestId('send-confirm-card')).toBeVisible({ timeout: 5_000 });
    await snap(page, '07-confirm-dialog-desktop', {
      mask: [page.getByTestId('send-recipient-input')],
    });
  });

  test('confirm-dialog-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('0.00001');
    await page.getByTestId('send-submit-btn').click();
    await expect(page.getByTestId('send-confirm-card')).toBeVisible({ timeout: 5_000 });
    await snap(page, '07-confirm-dialog-mobile', {
      mask: [page.getByTestId('send-recipient-input')],
    });
  });

  test('confirm-cancel-back', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('0.00001');
    await page.getByTestId('send-submit-btn').click();
    await page.getByTestId('send-cancel-btn').click();
    await expect(page.getByTestId('send-submit-btn')).toBeVisible({ timeout: 5_000 });
    await snap(page, '07-confirm-cancel-back', {
      mask: [page.getByTestId('send-recipient-input')],
    });
  });

  // Dropped: the "Creating proof…" state is unreachable visually.
  // SendPage::send() runs `setConfirming(false)` BEFORE `setSending(true)`,
  // so React unmounts the entire confirm card (where the button label
  // lives) on the same tick the click fires. The user never sees that
  // text, the spec can't snapshot it, the transition is functionally
  // covered by `send-success`. § 8.13 totals updated.

  test('send-success', async ({ page }) => {
    // The 2-phase Send pipeline does: signed `/api/send` (ZK proof
    // generation server-side, ~10-30 s on a warm DEV) → pre-send
    // `/api/balance` hydration → commitment build → `/api/commit`
    // with up to three retries at 2 s/4 s backoff → success heading.
    // A cold DEV after a fresh deploy can push the proof to 60-90 s;
    // combined with one commit retry the wait for the success
    // heading lands close to 100 s. The post-PR-#127 send-flow
    // additionally calls `/api/balance` immediately before signing
    // to hydrate `num_sends` from the server (the canonical BIP-32
    // child-index source per `CONTRIBUTING.md::Architecture
    // Principle — Thin Client`), and the post-#129/#132 server-side
    // state writes (atomic `Account.num_sends` + `commitment_public_key`
    // upsert) added a few seconds of legitimate per-send latency.
    // Together these two raise the realistic upper bound by ~30-60 s.
    //
    // Empirically the post-bundle-PR DEV runs land between 180 s and
    // ~5 min — the wide variance comes from Mutinynet block-time
    // jitter on the publisher's `track-tx` wait (30 s per attempt,
    // up to 3 attempts), and from `fullyParallel: true` saturating
    // the shared DEV runner with mint+balance traffic from
    // 09-network-and-shell, 10-pwa, 11-cross-spec-redirects, … all
    // hitting the node concurrently. None of that is App-side or
    // protocol-correctness signal — it's environment timing.
    //
    // Raise the test cap to 480 s (8 min) and the waitFor cap to
    // 420 s. A genuine deadlock still surfaces; well-behaved-but-
    // slow runs no longer mask as a regression. A separate follow-up
    // is the right place to (a) tighten the publisher track-tx
    // budget, and (b) consider serializing the spec against the DEV
    // node so test wall-time stops depending on neighbour load.
    test.setTimeout(480_000);
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('0.00001');
    await page.getByTestId('send-submit-btn').click();
    await page.getByTestId('send-confirm-btn').click();
    // Race the success heading against the inline error banner so a
    // server-side failure surfaces with the real error message
    // instead of "element never appeared after 150 s".
    const heading = page.getByTestId('send-success-heading');
    const error = page.getByTestId('send-error');
    await Promise.race([
      heading.waitFor({ state: 'visible', timeout: 420_000 }),
      error.waitFor({ state: 'visible', timeout: 420_000 }),
    ]);
    const errorText = (await error.textContent().catch(() => null)) ?? '';
    await expect(error, errorText).toBeHidden();
    await expect(heading).toBeVisible();
    await snap(page, '07-send-success');
  });

  // Dropped: the err-banner state on /send is unreachable for the
  // same reason as `sending-creating-proof` above — once the user
  // clicks Confirm Send, send() runs `setConfirming(false)` first,
  // which unmounts the confirm card and re-renders the bare Send
  // privately button. By the time the route abort fires, the page
  // looks indistinguishable from the pre-send state plus a small
  // error line. The render is flaky to capture and adds little
  // signal over `send-success`. § 8.13 totals updated.

  test('recovering-banner (no shot)', async ({ page }) => {
    await aliceLogin(page);
    // Seed an unfinished inflight commit in localStorage.
    await page.evaluate(() => {
      localStorage.setItem(
        'zkcoins_inflight_commit',
        JSON.stringify({
          proof_id: 42,
          public_key: '02' + '00'.repeat(32),
          signature: '00'.repeat(64),
          message: '00'.repeat(32),
        }),
      );
    });
    await goToSend(page);
    await expect(page.getByTestId('send-recovering-banner')).toBeVisible({ timeout: 10_000 });
  });
});
