/**
 * Spec 06 — View balance
 *
 * Covers § 8.6 of e2e/README.md. WalletScreen balance area + copy chip
 * + empty-state banner + transaction list under Alice (funded) and Bob
 * (empty). 4 tests, 4 linux baselines (one mobile).
 *
 * The faucet-button-visible / faucet-minting tests are gone — mint is
 * MVP and the UI gates the button purely on `networkName !==
 * mainnet`, so the button IS present on DEV (Mutinynet). Faucet-flow
 * functional coverage lives in the legacy `wallet.spec.ts`; this spec
 * just baselines the empty/funded chrome.
 *
 * Locators: testid-based throughout. The funded-vs-empty signal is
 * `wallet-empty-banner` visibility.
 */

import { expect, test } from '@playwright/test';
import { aliceLogin, bobLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('View balance', () => {
  test('balance-funded-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await aliceLogin(page);
    // Wait for the balance polling tick to land; until then the
    // empty-banner could briefly show.
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    // The single-asset balance hero (`multi_asset:false` surface) is the
    // funded wallet's primary chrome — assert it before baselining.
    await expect(page.getByTestId('balance-value')).toBeVisible({ timeout: 30_000 });
    // issue #175: a funded wallet renders its server-owned history
    // (`GET /api/history`) — at least the faucet mint — NOT the empty
    // state. Alice is seeded by globalSetup, so the mint row must appear
    // without any local action. The amount/time are masked in the golden;
    // the row's presence is the regression guard the previous baseline lacked.
    await expect(page.getByTestId('tx-row-amount').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('No transactions yet')).toHaveCount(0);
    await snap(page, '06-balance-funded-desktop');
  });

  test('balance-funded-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    // issue #175 — funded wallet shows server history, not the empty state.
    await expect(page.getByTestId('tx-row-amount').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('No transactions yet')).toHaveCount(0);
    await snap(page, '06-balance-funded-mobile');
  });

  test('balance-hidden', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    await page.getByTestId('balance-toggle-btn').click();
    await expect(page.getByTestId('balance-toggle-btn')).toHaveAttribute('data-hidden', 'true');
    // fullPage so the toggle-icon flip + the now-shown HIDDEN placeholder
    // are both captured (mobile viewport otherwise clips below the chrome).
    await snap(page, '06-balance-hidden', { fullPage: true });
  });

  test('balance-zero-empty-banner', async ({ page }) => {
    await setViewport(page, 'mobile');
    await bobLogin(page);
    await expect(page.getByTestId('wallet-empty-banner')).toBeVisible({ timeout: 30_000 });
    // DEV runs on Mutinynet — the empty-banner UI exposes the faucet
    // button as the primary CTA. The companion check that the button
    // is *not* rendered on Mainnet lives in the unit-test layer
    // (`WalletScreen` test for `showFaucet` with `networkName: "Mainnet"`)
    // since E2E always runs against the testnet API.
    await expect(page.getByTestId('faucet-btn')).toBeVisible();
    // fullPage so the empty-banner + faucet button are both captured.
    await snap(page, '06-balance-zero-empty-banner', { fullPage: true });
  });

  test('balance-copied-feedback', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('address-copy-btn').click();
    await expect(page.getByTestId('address-copied-feedback')).toBeVisible({ timeout: 2_000 });
    // fullPage so the toast/feedback area below the balance card is
    // captured — the differentiator vs. funded-mobile lives there.
    await snap(page, '06-balance-copied-feedback', { fullPage: true });
  });
});
