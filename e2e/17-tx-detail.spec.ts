/**
 * Spec 17 — Transaction detail page (`/tx/[id]`).
 *
 * Covers the tx-detail feature: a funded wallet's history row is
 * clickable and opens a dedicated detail page that renders every field
 * the node's `GET /api/history/{id}` returns.
 *
 * ## Why the detail route is mocked
 *
 * The local multi-asset node serves the history *list* (`GET /api/history`)
 * but does NOT expose the per-transaction detail route
 * (`GET /api/history/{id}` → 404 against this node). Without it the page
 * can only ever render its not-found state, so the detail-body goldens
 * would be impossible to produce against the live node.
 *
 * Rather than drop the coverage, these specs intercept the detail route
 * with a `page.route()` mock that returns a deterministic `TxDetail`
 * envelope (a settled `mint`, matching what the node's `router::TxDetail`
 * serializes). The history list — and therefore the clickable `tx-row`
 * the user taps — stays live (it comes from the real node). Only the
 * one-shot detail fetch behind the click is mocked, so the spec still
 * exercises the real list → row-click → detail-page render path.
 *
 * The `tx-detail-missing` case needs no mock: it asserts the genuine
 * not-found surface (a hard nav drops the in-memory account, so the hook
 * resolves to not_found without a request).
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

/**
 * A deterministic `mint` `TxDetail`, shaped exactly like the node's
 * `router::TxDetail` serde (see `@zkcoins/sdk` `TxDetailSchema`). A mint:
 * pending, no commit txid (→ "Not yet broadcast", no explorer link),
 * private counterparty. The decoded account-state snapshot is populated so
 * the detail body renders every section.
 */
function mintDetail(id: number, address: string) {
  return {
    id,
    txid: null,
    timestamp: 1_780_903_685,
    direction: 'mint' as const,
    amount: 100_000,
    counterparty: null,
    status: 'pending' as const,
    block_height: null,
    memo: null,
    address: address.replace(/^0x/, '').toLowerCase(),
    balance_after: 100_000,
    balance_before: null,
    num_sends_after: 0,
    commitment_public_key: null,
    circuit_digest: 'a'.repeat(64),
    commit_output_value: null,
  };
}

/**
 * Mock the per-transaction detail route (`GET /api/history/{id}`) — absent
 * on the local node — so the detail page renders against a deterministic
 * mint. Matched on the pathname so it's robust to the `?address=` query and
 * any same-origin proxying. The history *list* route is left untouched, so
 * the clickable `tx-row` still comes from the live node.
 */
async function mockTxDetail(page: Page): Promise<void> {
  await page.context().route(/\/api\/history\/(\d+)(?:\?|$)/, (route) => {
    const match = route
      .request()
      .url()
      .match(/\/api\/history\/(\d+)/);
    const id = match ? Number(match[1]) : 1;
    const url = new URL(route.request().url());
    const address = url.searchParams.get('address') ?? 'e2e';
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mintDetail(id, address)),
    });
  });
}

/** Log Alice in and open the detail page for her first (newest) tx. */
async function openFirstTxDetail(page: Page): Promise<void> {
  await mockTxDetail(page);
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

    // The mocked row is a faucet mint, pending until the on-chain side is
    // known. These are server-truth and stable across runs.
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
    // Back on the wallet screen — the funded portfolio list is the stable
    // anchor (the single-balance hero was removed in the multi-asset redesign).
    await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 15_000 });
  });

  test('tx-detail-missing', async ({ page }) => {
    // A hard navigation to a tx URL drops the in-memory account, so the
    // page resolves to the not-found state without a doomed request — the
    // same surface a genuinely-unknown id renders. Covers the missing UI.
    // No detail-route mock here: this asserts the real not-found surface.
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await page.goto('/tx/999999999');
    await expect(page.getByTestId('tx-detail-missing')).toContainText('Transaction not found', {
      timeout: 15_000,
    });
    await snap(page, '17-tx-detail-missing', { fullPage: true });
  });
});
