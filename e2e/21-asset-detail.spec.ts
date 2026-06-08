/**
 * Spec 21 — Per-asset detail screen (`/asset/[id]`)
 *
 * Tapping a portfolio row opens this screen: a balance hero, a Details
 * card (name / asset id / decimals / balance / send counter), a
 * "Send this asset" deep-link into `/send?asset=…`, and the per-wallet
 * history note + list. This spec baselines:
 *
 *   - happy    — Alice opens her first held asset (desktop + mobile). The
 *                volatile values (balance, asset id, send counter, and the
 *                per-run history rows) are masked; the labels + layout are
 *                the regression guard.
 *   - missing  — an in-app navigation to a bogus asset id keeps the account
 *                in memory, so the portfolio resolves `loaded=true` without
 *                the asset → the `asset-detail-missing` not-found surface.
 *   - loading  — the portfolio fetch is held open; the page renders only
 *                its header while neither the body nor the missing state
 *                has resolved.
 *
 * `/asset/[id]` renders with `showNav={false}` (no BottomNav).
 */

import { expect, test, type Page } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

/** Masked volatile cells on the detail body. The asset NAME is volatile
 *  (globalSetup mints `E2E-<ts>-<rand>` fixtures), so both the hero name and
 *  the Details "Name" row are masked alongside the balance/id/send-counter
 *  and the per-run history rows. */
function detailMasks(page: Page) {
  return [
    page.getByTestId('asset-detail-name'),
    page.getByTestId('asset-detail-balance'),
    page.getByTestId('asset-detail-id-short'),
    page.getByTestId('asset-row-name'),
    page.getByTestId('asset-row-id'),
    page.getByTestId('asset-row-balance'),
    page.getByTestId('asset-row-sends'),
    // Per-run history rows beneath the details card.
    page.getByTestId('asset-tx-row'),
  ];
}

/** Log Alice in and open the detail page for her first held asset. */
async function aliceOpenFirstAsset(page: Page): Promise<void> {
  await aliceLogin(page);
  await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('asset-row').first().click();
  await expect(page.getByTestId('asset-detail-body')).toBeVisible({ timeout: 30_000 });
}

test.describe('Asset detail', () => {
  test('Visual Regression — asset-detail-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await aliceOpenFirstAsset(page);
    // The Details card and the send deep-link are present.
    await expect(page.getByTestId('asset-send-btn')).toBeVisible();
    await expect(page.getByTestId('asset-history-note')).toBeVisible();
    await snap(page, '21-asset-detail-desktop', { mask: detailMasks(page) });
  });

  test('Visual Regression — asset-detail-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceOpenFirstAsset(page);
    await expect(page.getByTestId('asset-send-btn')).toBeVisible();
    await snap(page, '21-asset-detail-mobile', { fullPage: true, mask: detailMasks(page) });
  });

  test('Visual Regression — asset-detail-missing', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
    // The not-found surface needs account-in-memory (so the portfolio loads)
    // AND the requested asset absent from the portfolio. The wallet store keeps
    // the account in memory but does NOT survive a hard reload, so a
    // `page.goto('/asset/<bogus>')` would drop the account and render only the
    // header. So: click the REAL first asset-row (a Next <Link> — a genuine
    // client-side nav that preserves the account), but install a portfolio
    // route FIRST that returns an empty asset list. The detail page's own
    // `usePortfolio` tick then resolves `loaded=true` with the asset absent →
    // the `asset-detail-missing` surface. (Rewriting the Link's DOM `href`
    // doesn't work: Next routes from the React `href` prop, not the attribute.)
    await page.context().route(/\/api\/balance\/[^/?]+$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ address: 'e2e', assets: [] }),
      }),
    );
    await page.getByTestId('asset-row').first().click();
    await expect(page.getByTestId('asset-detail-missing')).toBeVisible({ timeout: 30_000 });
    await snap(page, '21-asset-detail-missing', { fullPage: true });
  });

  test('Visual Regression — asset-detail-loading', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await expect(page.getByTestId('asset-list')).toBeVisible({ timeout: 30_000 });
    // Hold the NEXT portfolio fetch open, then client-side navigate to the
    // first asset's detail by clicking its row (preserves the in-memory
    // account — a hard `goto` would drop it). With the fetch in flight the
    // detail page renders only its header: `usePortfolio` keeps `loaded`
    // false, so neither the body nor the missing surface shows yet.
    await page.context().route(/\/api\/balance\/[^/?]+$/, async (route) => {
      await new Promise((r) => setTimeout(r, 20_000));
      await route.abort();
    });
    await page.getByTestId('asset-row').first().click();
    await expect(page.getByTestId('asset-detail-back')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('asset-detail-body')).toHaveCount(0);
    await expect(page.getByTestId('asset-detail-missing')).toHaveCount(0);
    await snap(page, '21-asset-detail-loading', { fullPage: true });
  });
});
