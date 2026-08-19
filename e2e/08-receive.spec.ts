/**
 * Spec 08 — Receive
 *
 * Without a provisioned name, Receive is not available (Send rejects raw
 * zk1 addresses). Fixtures do not claim names, so the honest surface is
 * `receive-not-available`.
 */

import { expect, test, type Page } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

async function goToReceive(page: Page): Promise<void> {
  await page.getByTestId('wallet-receive-btn').click();
  await expect(page.getByTestId('receive-heading')).toBeVisible({ timeout: 10_000 });
}

test.describe('Receive — not available without a name', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000);
    await aliceLogin(page);
  });

  test('receive-not-available-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await goToReceive(page);
    await expect(page.getByTestId('receive-not-available')).toBeVisible();
    await expect(page.getByTestId('qr-code')).toHaveCount(0);
    await snap(page, '08-receive-default-desktop');
  });

  test('receive-not-available-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await goToReceive(page);
    await expect(page.getByTestId('receive-not-available')).toBeVisible();
    await expect(page.getByTestId('receive-copy-btn')).toHaveCount(0);
    await snap(page, '08-receive-default-mobile');
  });

  test('receive-back-to-wallet', async ({ page }) => {
    await setViewport(page, 'mobile');
    await goToReceive(page);
    await page.getByTestId('receive-back-link').click();
    await expect(page.getByTestId('portfolio-unavailable-banner')).toBeVisible({
      timeout: 30_000,
    });
    await snap(page, '08-receive-back-to-wallet', { fullPage: true });
  });
});
