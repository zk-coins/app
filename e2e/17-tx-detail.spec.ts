/**
 * Spec 17 — Transaction detail page (`/tx/[id]`).
 *
 * Covers the tx-detail feature: a funded wallet's history row is
 * clickable and opens a dedicated detail page that renders every field
 * the node's `GET /v1/history/{id}` returns. Alice (funded by
 * globalSetup) has a faucet mint, so her first row's detail is a
 * `mint` with the decoded account-state snapshot.
 *
 * Volatile values (id, timestamp, amounts, hashes) carry `tx-detail-v-*`
 * testids and are masked + width-pinned (see `_helpers/screenshot.ts`),
 * so the golden asserts the layout/labels/status, not per-run values.
 */

import { expect, test, type Page } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

// Every per-run value cell on the detail page — masked in the golden and
// width-pinned to a uniform box. Listing them here also satisfies the
// button-coverage audit (each id is referenced via getByTestId).
const VALUE_TESTIDS = [
  'tx-detail-v-amount',
  'tx-detail-v-time',
  'tx-detail-v-id',
  'tx-detail-v-amount-full',
  'tx-detail-v-balance-after',
  'tx-detail-v-balance-before',
  'tx-detail-v-num-sends',
  'tx-detail-v-circuit-digest',
  'tx-detail-v-commitment-key',
  'tx-detail-v-txid',
  'tx-detail-v-block-height',
  'tx-detail-v-commit-value',
];

/** Log Alice in and open the detail page for her first (newest) tx. */
async function openFirstTxDetail(page: Page): Promise<void> {
  await aliceLogin(page);
  // Funded wallet → the empty banner is absent and the history list renders.
  await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('tx-row').first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('tx-row').first().click();
  await expect(page.getByTestId('tx-detail-body')).toBeVisible({ timeout: 30_000 });
}

test.describe('Transaction detail', () => {
  test('tx-detail-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await openFirstTxDetail(page);

    // Alice's seeded row is a faucet mint, pending until the on-chain side
    // is known. These are server-truth and stable across runs.
    await expect(page.getByTestId('tx-detail-label')).toHaveText('Faucet');
    await expect(page.getByTestId('tx-detail-status')).toContainText('pending');
    await expect(page.getByTestId('tx-detail-direction')).toContainText('Faucet');
    await expect(page.getByTestId('tx-detail-account')).toBeVisible();
    await expect(page.getByTestId('tx-detail-verification')).toBeVisible();
    await expect(page.getByTestId('tx-detail-counterparty')).toContainText('Private');
    await expect(page.getByTestId('tx-detail-memo')).toBeVisible();
    await expect(page.getByTestId('tx-detail-source')).toContainText('Your node');
    // A mint has no commit txid yet → no explorer link, "Not yet broadcast".
    await expect(page.getByTestId('tx-detail-txid')).toContainText('Not yet broadcast');
    await expect(page.getByTestId('tx-detail-explorer-link')).toHaveCount(0);
    // The decoded snapshot values are present (masked in the golden).
    await expect(page.getByTestId('tx-detail-v-balance-after')).toBeVisible();
    await expect(page.getByTestId('tx-detail-v-num-sends')).toBeVisible();
    // The loading frame has resolved.
    await expect(page.getByTestId('tx-detail-loading')).toHaveCount(0);

    await snap(page, '17-tx-detail-desktop', {
      mask: VALUE_TESTIDS.map((t) => page.getByTestId(t)),
    });
  });

  test('tx-detail-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await openFirstTxDetail(page);
    await expect(page.getByTestId('tx-detail-label')).toHaveText('Faucet');
    await snap(page, '17-tx-detail-mobile', {
      fullPage: true,
      mask: VALUE_TESTIDS.map((t) => page.getByTestId(t)),
    });
  });

  test('tx-detail-back-returns-to-wallet', async ({ page }) => {
    await setViewport(page, 'mobile');
    await openFirstTxDetail(page);
    await page.getByTestId('tx-detail-back').click();
    // Back on the wallet screen — the balance area is the stable anchor.
    await expect(page.getByTestId('balance-amount-usd')).toBeVisible({ timeout: 15_000 });
  });

  test('tx-detail-missing', async ({ page }) => {
    // A hard navigation to a tx URL drops the in-memory account, so the
    // page resolves to the not-found state without a doomed request — the
    // same surface a genuinely-unknown id renders. Covers the missing UI.
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await page.goto('/tx/999999999');
    await expect(page.getByTestId('tx-detail-missing')).toContainText('Transaction not found', {
      timeout: 15_000,
    });
    await snap(page, '17-tx-detail-missing', { fullPage: true });
  });
});
