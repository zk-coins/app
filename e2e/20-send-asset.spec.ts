/**
 * Spec 20 — Send with the multi-asset picker (`/send`)
 *
 * Send is now per-asset: the form leads with an asset `<select>` populated
 * from the wallet's portfolio, an "Available" readout for the chosen
 * asset, and an amount field denominated in that asset. This spec
 * baselines:
 *
 *   - picker      — Alice's portfolio drives the select; the first asset is
 *                   auto-selected and its "Available" balance shows.
 *   - amount      — a valid amount typed → "Send privately" enabled.
 *   - confirm     — the confirm card (amount + recipient + Cancel/Confirm),
 *                   desktop + mobile.
 *   - empty       — reached as Bob (zero assets): `send-asset-empty`
 *                   ("No assets to send. Create a coin first.") and the
 *                   submit button disabled.
 *
 * Volatile content masked: the recipient input (Bob's per-run hex
 * address), the asset select (carries the per-run balance + asset name),
 * and the "Available" readout. The recipient line inside the confirm card
 * is masked too.
 */

import { expect, test, type Page } from '@playwright/test';
import { readAccounts, aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';
import { multiAssetEnabled } from './_helpers/capabilities';

/** Log Alice in (funded) and open `/send`. */
async function aliceGoToSend(page: Page): Promise<void> {
  await aliceLogin(page);
  await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wallet-send-btn').click();
  await expect(page.getByTestId('send-heading')).toBeVisible({ timeout: 10_000 });
  // The picker hydrates from the portfolio tick — wait for it to populate.
  await expect(page.getByTestId('send-asset-select')).toBeVisible({ timeout: 30_000 });
}

/** Volatile cells masked in every send golden. The asset select option text
 *  and the "Available" readout both carry the per-run asset name + balance. */
function sendMasks(page: Page) {
  return [
    page.getByTestId('send-recipient-input'),
    page.getByTestId('send-asset-select'),
    page.getByTestId('send-available'),
  ];
}

/** The confirm card echoes the volatile asset name (in the "Send {amount}
 *  {asset} to:" line) and the per-run recipient hex (the `.mono` line) —
 *  mask both so the golden checks the card's layout + buttons, not values. */
function confirmCardMasks(page: Page) {
  return [
    page.getByTestId('send-confirm-card').locator('p').first(),
    page.getByTestId('send-confirm-card').locator('p.mono'),
  ];
}

test.describe('Send asset', () => {
  // Gated on the runtime multi-asset capability: these screens only
  // exist on a `multi_asset:true` node. On the single-asset CI leg
  // (info-proxy forces it false) the whole describe skips; it runs
  // against a true node (local Docker harness).
  test.beforeEach(async () => {
    test.skip(!(await multiAssetEnabled()), 'multi_asset disabled on this node');
  });

  test('Visual Regression — send-asset-picker', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceGoToSend(page);
    // First asset auto-selected → the "Available" readout has resolved
    // (not the `—` loading placeholder).
    await expect(page.getByTestId('send-available')).not.toHaveAttribute('data-loading', 'true');
    await snap(page, '20-send-asset-picker', { fullPage: true, mask: sendMasks(page) });
  });

  test('Visual Regression — send-asset-amount', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('1');
    // Both fields valid + assets present → submit enabled.
    await expect(page.getByTestId('send-submit-btn')).toBeEnabled();
    await snap(page, '20-send-asset-amount', { fullPage: true, mask: sendMasks(page) });
  });

  test('Visual Regression — send-asset-confirm-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('1');
    await page.getByTestId('send-submit-btn').click();
    await expect(page.getByTestId('send-confirm-card')).toBeVisible({ timeout: 10_000 });
    await snap(page, '20-send-asset-confirm-desktop', {
      // The confirm card echoes the recipient hex — mask it along with the
      // form fields underneath.
      mask: [...sendMasks(page), ...confirmCardMasks(page)],
    });
  });

  test('Visual Regression — send-asset-confirm-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    const { bob } = readAccounts();
    await aliceGoToSend(page);
    await page.getByTestId('send-recipient-input').fill(bob.address);
    await page.getByTestId('send-amount-input').fill('1');
    await page.getByTestId('send-submit-btn').click();
    await expect(page.getByTestId('send-confirm-card')).toBeVisible({ timeout: 10_000 });
    await snap(page, '20-send-asset-confirm-mobile', {
      fullPage: true,
      mask: [...sendMasks(page), ...confirmCardMasks(page)],
    });
  });

  test('Visual Regression — send-asset-empty', async ({ page }) => {
    await setViewport(page, 'mobile');
    // The empty send form needs an account in memory AND a zero-asset
    // portfolio. Bob is the zero-asset fixture, but his `wallet-send-btn` is
    // disabled (no assets) and a hard `goto('/send')` drops the in-memory
    // account → the page's no-account redirect fires. So drive Alice (funded,
    // so her send button is an ENABLED Next <Link> to /send) and intercept the
    // portfolio to return an empty asset list: clicking her send button is a
    // genuine client-side nav that preserves the account, and the send page's
    // own portfolio tick resolves empty → the `send-asset-empty` state.
    // (Rewriting a Link's DOM `href` doesn't work: Next routes from the React
    // `href` prop, not the attribute.)
    await aliceLogin(page);
    await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
    await page.context().route(/\/v1\/balance\/[^/?]+$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ address: 'e2e', assets: [] }),
      }),
    );
    await page.getByTestId('wallet-send-btn').click();
    await expect(page.getByTestId('send-heading')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('send-asset-empty')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('send-submit-btn')).toBeDisabled();
    await snap(page, '20-send-asset-empty', { fullPage: true });
  });
});
