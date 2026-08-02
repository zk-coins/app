/**
 * Spec 07 — Send surface (honest unavailability)
 *
 * Send requires input-coin selection from AccountState inventory, which is
 * not wired in this build. The product fails closed: the wallet Send button
 * is disabled, and `/send` renders an unavailable banner without posting
 * to `/v1/tx`. Form/success scenarios return once the read/inventory path
 * ships (named follow-up block).
 */

import { expect, test } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('Send — not available in this build', () => {
  test('wallet send button is disabled (no navigation into a live form)', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    const sendBtn = page.getByTestId('wallet-send-btn');
    await expect(sendBtn).toHaveAttribute('aria-disabled', 'true');
  });

  test('Visual Regression — send-unavailable', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    // Direct navigation — the wallet CTA is disabled on purpose.
    await page.goto('/send');
    await expect(page.getByTestId('send-heading')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('send-unavailable-banner')).toBeVisible();
    // No live form controls that would imply a working send path.
    await expect(page.getByTestId('send-recipient-input')).toHaveCount(0);
    await expect(page.getByTestId('send-submit-btn')).toHaveCount(0);
    await snap(page, '07-send-default');
  });

  test('send page does not POST /v1/tx', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/v1/tx')) {
        posts.push(req.url());
      }
    });
    await page.goto('/send');
    await expect(page.getByTestId('send-unavailable-banner')).toBeVisible();
    await page.waitForTimeout(500);
    expect(posts).toEqual([]);
  });
});
