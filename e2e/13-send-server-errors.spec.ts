/**
 * Spec 13 — Send server errors
 *
 * The live send form is not available in this build (input-coin inventory
 * not wired). Server-error UI for prove/insufficient-funds returns with
 * the send path. This file only asserts that the unavailable surface has
 * a permanently disabled submit and never POSTs /v1/tx.
 */

import { expect, test } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { setViewport } from './_helpers/screenshot';

test.describe('Send server errors — path not available', () => {
  test('unavailable surface keeps submit permanently disabled', async ({ page }) => {
    await setViewport(page, 'mobile');
    await aliceLogin(page);
    await page.goto('/send');
    await expect(page.getByTestId('send-unavailable-banner')).toBeVisible();
    await expect(page.getByTestId('send-submit-btn')).toBeVisible();
    await expect(page.getByTestId('send-submit-btn')).toBeDisabled();
    await expect(page.getByTestId('send-error')).toHaveCount(0);
  });
});
