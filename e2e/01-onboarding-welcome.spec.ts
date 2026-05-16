/**
 * Spec 01 — Onboarding Welcome screen
 *
 * Covers § 8.1 of e2e/README.md. The landing entry plus both onward
 * affordances at three viewport widths, plus the two primary CTA hover
 * states. Five tests, five linux baselines.
 *
 * DEV-only widgets visible in these baselines (per § 8.0 (b)):
 *   - `dev-*` hostnames in the FooterLinks row at the bottom of the card.
 *
 * No fixture login — this spec is the user's very first contact with the
 * app and must run from a blank-slate state.
 */

import { expect, test } from '@playwright/test';
import { clearWalletState } from './_helpers/wallet';
import { snap, setViewport } from './_helpers/screenshot';

test.describe('Welcome', () => {
  test.beforeEach(async ({ page }) => {
    await clearWalletState(page);
  });

  test('welcome-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await page.goto('/');
    await expect(page.getByTestId('welcome-heading')).toBeVisible();
    await expect(page.getByTestId('onboarding-create-btn')).toBeVisible();
    await expect(page.getByTestId('onboarding-restore-btn')).toBeVisible();
    await snap(page, '01-welcome-desktop', { fullPage: true });
  });

  test('welcome-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await page.goto('/');
    await expect(page.getByTestId('welcome-heading')).toBeVisible();
    await snap(page, '01-welcome-mobile', { fullPage: true });
  });

  test('welcome-tablet', async ({ page }) => {
    await setViewport(page, 'tablet');
    await page.goto('/');
    await expect(page.getByTestId('welcome-heading')).toBeVisible();
    await snap(page, '01-welcome-tablet', { fullPage: true });
  });

  test('welcome-create-hover', async ({ page }) => {
    await setViewport(page, 'desktop');
    await page.goto('/');
    const createButton = page.getByTestId('onboarding-create-btn');
    await expect(createButton).toBeVisible();
    await createButton.hover();
    // Give the colour transition time to land (Tailwind `transition-colors`
    // defaults to 150 ms; we wait the same.)
    await page.waitForTimeout(200);
    await snap(page, '01-welcome-create-hover');
  });

  test('welcome-restore-hover', async ({ page }) => {
    await setViewport(page, 'desktop');
    await page.goto('/');
    const restoreLink = page.getByTestId('onboarding-restore-btn');
    await expect(restoreLink).toBeVisible();
    await restoreLink.hover();
    await page.waitForTimeout(200);
    await snap(page, '01-welcome-restore-hover');
  });
});
