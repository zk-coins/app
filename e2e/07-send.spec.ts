/**
 * Spec 07 — Send Bitcoin (2-phase)
 *
 * Covers § 8.7 of e2e/README.md. The full Send pipeline plus every
 * error branch. 15 tests, 14 linux baselines, 1 no-shot.
 *
 * Alice (funded, 100 000 sats) sends 1 000 sats to Bob. The send
 * goes through real `/api/send` + `/api/commit` against DEV.
 *
 * DEV-only widgets visible in these baselines (per § 8.0 (b)):
 *   - Apps tab in BottomNav
 *   - `@user` / `$user` resolver hint placeholder on the recipient
 *     input (FEATURES.USERNAMES)
 *   - "Buy private BTC through DFX" link inside the No-funds banner
 *     (the Bob `send-no-funds-banner` shot)
 *   - `dev-*` hostnames in the FooterLinks row
 */

import { expect, test, type Page } from '@playwright/test';
import { readAccounts, aliceLogin, bobLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

/** Navigate Wallet → /send via the in-app Send link (client-side nav). */
async function goToSend(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Send' }).first().click();
  await expect(page.getByRole('heading', { name: 'Send Bitcoin' })).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Wait for Alice's `/api/balance` polling tick to land so the in-store
 * balance reflects her on-chain funds. Without this, the Send-page
 * `handleConfirm` sees `account.balance === 0` and rejects every amount
 * with "Insufficient balance" — the confirm dialog never opens.
 *
 * Called from WalletScreen state: when balance > 0 the "Wallet is empty"
 * banner is removed by the polling tick.
 */
async function waitForAliceBalanceLoaded(page: Page): Promise<void> {
  await expect(page.getByText('Wallet is empty')).not.toBeVisible({ timeout: 30_000 });
}

/**
 * Common Alice setup for Send tests: log in, wait for balance, navigate
 * to /send via the in-app link. Every Send test that needs to enter a
 * valid amount calls this.
 */
async function aliceGoToSend(page: Page): Promise<void> {
  await aliceLogin(page);
  await waitForAliceBalanceLoaded(page);
  await goToSend(page);
}

test.describe('Send Bitcoin', () => {
  test('send-default', async ({ page }) => {
    await setViewport(page, 'desktop');
    await aliceGoToSend(page);
    await expect(page.getByRole('button', { name: 'Send privately' })).toBeDisabled();
    await snap(page, '07-send-default');
  });

  test('send-no-funds-banner', async ({ page }) => {
    await setViewport(page, 'desktop');
    await bobLogin(page);
    await goToSend(page);
    await expect(page.getByText('No funds to send.')).toBeVisible({ timeout: 30_000 });
    await snap(page, '07-send-no-funds-banner');
  });

  test('recipient-valid-hex', async ({ page }) => {
    await setViewport(page, 'desktop');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.locator('input[placeholder]').first().fill(bob.address);
    // Amount still empty → button still disabled.
    await expect(page.getByRole('button', { name: 'Send privately' })).toBeDisabled();
    await snap(page, '07-recipient-valid-hex', {
      mask: [page.locator('input[placeholder]').first()],
    });
  });

  test('recipient-valid-username', async ({ page }) => {
    await setViewport(page, 'desktop');
    await aliceGoToSend(page);
    await page.locator('input[placeholder]').first().fill('bob@zkcoins.app');
    await snap(page, '07-recipient-valid-username', {
      mask: [page.locator('input[placeholder]').first()],
    });
  });

  test('amount-typed', async ({ page }) => {
    await setViewport(page, 'desktop');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.locator('input[placeholder]').first().fill(bob.address);
    await page.locator('input[inputMode="decimal"]').fill('0.00001');
    await expect(page.getByRole('button', { name: 'Send privately' })).toBeEnabled();
    await snap(page, '07-amount-typed', {
      mask: [page.locator('input[placeholder]').first()],
    });
  });

  test('amount-set-max-clicked', async ({ page }) => {
    await setViewport(page, 'desktop');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.locator('input[placeholder]').first().fill(bob.address);
    await page.getByText('Set max').click();
    await snap(page, '07-amount-set-max-clicked', {
      mask: [
        page.locator('input[placeholder]').first(),
        page.locator('input[inputMode="decimal"]'),
      ],
    });
  });

  test('amount-invalid-text', async ({ page }) => {
    await setViewport(page, 'desktop');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.locator('input[placeholder]').first().fill(bob.address);
    await page.locator('input[inputMode="decimal"]').fill('abc');
    await page.getByRole('button', { name: 'Send privately' }).click();
    await expect(page.getByText('Invalid amount')).toBeVisible({ timeout: 5_000 });
    await snap(page, '07-amount-invalid-text', {
      mask: [page.locator('input[placeholder]').first()],
    });
  });

  test('amount-insufficient', async ({ page }) => {
    await setViewport(page, 'desktop');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.locator('input[placeholder]').first().fill(bob.address);
    await page.locator('input[inputMode="decimal"]').fill('999');
    await page.getByRole('button', { name: 'Send privately' }).click();
    await expect(page.getByText('Insufficient balance')).toBeVisible({ timeout: 5_000 });
    await snap(page, '07-amount-insufficient', {
      mask: [page.locator('input[placeholder]').first()],
    });
  });

  test('confirm-dialog-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.locator('input[placeholder]').first().fill(bob.address);
    await page.locator('input[inputMode="decimal"]').fill('0.00001');
    await page.getByRole('button', { name: 'Send privately' }).click();
    await expect(page.getByText('This cannot be undone.')).toBeVisible({ timeout: 5_000 });
    await snap(page, '07-confirm-dialog-desktop', {
      mask: [page.locator('input[placeholder]').first()],
    });
  });

  test('confirm-dialog-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.locator('input[placeholder]').first().fill(bob.address);
    await page.locator('input[inputMode="decimal"]').fill('0.00001');
    await page.getByRole('button', { name: 'Send privately' }).click();
    await expect(page.getByText('This cannot be undone.')).toBeVisible({ timeout: 5_000 });
    await snap(page, '07-confirm-dialog-mobile', {
      mask: [page.locator('input[placeholder]').first()],
    });
  });

  test('confirm-cancel-back', async ({ page }) => {
    await setViewport(page, 'desktop');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.locator('input[placeholder]').first().fill(bob.address);
    await page.locator('input[inputMode="decimal"]').fill('0.00001');
    await page.getByRole('button', { name: 'Send privately' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Send privately' })).toBeVisible({
      timeout: 5_000,
    });
    await snap(page, '07-confirm-cancel-back', {
      mask: [page.locator('input[placeholder]').first()],
    });
  });

  test('sending-creating-proof', async ({ page }) => {
    test.setTimeout(60_000);
    await setViewport(page, 'desktop');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.locator('input[placeholder]').first().fill(bob.address);
    await page.locator('input[inputMode="decimal"]').fill('0.00001');
    await page.getByRole('button', { name: 'Send privately' }).click();
    // Stall /api/send so the "Creating proof…" button label has time
    // to land in the DOM before the response arrives.
    await page.route('**/api/send', async (route) => {
      await new Promise((r) => setTimeout(r, 3_000));
      await route.continue();
    });
    await page.getByRole('button', { name: 'Confirm Send' }).click();
    await expect(page.getByText('Creating proof…')).toBeVisible({ timeout: 5_000 });
    await snap(page, '07-sending-creating-proof', {
      mask: [page.locator('input[placeholder]').first()],
    });
  });

  test('send-success', async ({ page }) => {
    test.setTimeout(120_000);
    await setViewport(page, 'desktop');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.locator('input[placeholder]').first().fill(bob.address);
    await page.locator('input[inputMode="decimal"]').fill('0.00001');
    await page.getByRole('button', { name: 'Send privately' }).click();
    await page.getByRole('button', { name: 'Confirm Send' }).click();
    await expect(page.getByRole('heading', { name: 'Sent privately' })).toBeVisible({
      timeout: 90_000,
    });
    await snap(page, '07-send-success');
  });

  test('send-failure-network', async ({ page }) => {
    await setViewport(page, 'desktop');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.locator('input[placeholder]').first().fill(bob.address);
    await page.locator('input[inputMode="decimal"]').fill('0.00001');
    await page.getByRole('button', { name: 'Send privately' }).click();
    // Force the /api/send POST to fail at the network layer.
    await page.route('**/api/send', (route) => route.abort());
    await page.getByRole('button', { name: 'Confirm Send' }).click();
    // The handler catches the error and sets `error` on the form.
    await expect(page.getByText(/err:/)).toBeVisible({ timeout: 10_000 });
    await snap(page, '07-send-failure-network', {
      mask: [page.locator('input[placeholder]').first()],
    });
  });

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
    await expect(page.getByText('Recovering a previous in-flight transaction…')).toBeVisible({
      timeout: 10_000,
    });
  });
});
