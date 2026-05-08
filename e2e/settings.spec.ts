import { test, expect, type Page } from '@playwright/test';

/**
 * Helper: create a wallet via the seed phrase flow.
 *
 * Flow: Welcome → CREATE WALLET → Passkey intro → OTHER LOGIN OPTIONS
 *       → Seed phrase → Tap to reveal → I've written it down → Continue
 *       → Set password → Create wallet → Wallet visible
 */
async function createWallet(page: Page) {
  await page.goto('/');

  // Clear any previous state.
  await page.evaluate(async () => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('zkcoins'))
      .forEach((k) => localStorage.removeItem(k));
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
  });
  await page.reload({ waitUntil: 'networkidle' });

  await page.getByText('CREATE WALLET').click();
  await page.getByText('OTHER LOGIN OPTIONS').click();
  await expect(page.getByText('Your seed phrase')).toBeVisible({ timeout: 15_000 });
  await page.getByText('Tap to reveal').click();
  await page.getByText("I've written it down").click();
  await page.getByText('Continue').click();

  const passwordInputs = page.locator('input[type="password"]');
  await passwordInputs.first().fill('TestPassword123!');
  await passwordInputs.last().fill('TestPassword123!');
  await page.getByText('Create wallet').click();

  // Wait for wallet to be fully loaded.
  await expect(page.locator('text=/[0-9a-f]{8}@zkcoins\\.app/').first()).toBeVisible({
    timeout: 20_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Settings page                                                      */
/* ------------------------------------------------------------------ */

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await createWallet(page);
    // Navigate via bottom nav
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 });
  });

  test('navigate to settings via bottom nav', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Wallet, network, and privacy preferences')).toBeVisible();
  });

  test('auth method displayed correctly for seed phrase', async ({ page }) => {
    await expect(page.getByText('Auth method')).toBeVisible();
    await expect(page.getByText('Seed phrase — wallet encrypted with your password')).toBeVisible();
  });

  test('network info shown', async ({ page }) => {
    // The Network label is in the About section
    await expect(page.getByText('Network').first()).toBeVisible();
  });

  test('version shown', async ({ page }) => {
    await expect(page.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
  });

  test('disconnect wallet button visible', async ({ page }) => {
    await expect(page.getByText('Disconnect Wallet')).toBeVisible();
  });

  test('disconnect confirmation dialog', async ({ page }) => {
    // Set up dialog handler to dismiss (cancel)
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.getByText('Disconnect Wallet').click();
    // After dismissing, we should still be on settings
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('after disconnect returns to onboarding', async ({ page }) => {
    // Accept the confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByText('Disconnect Wallet').click();

    // Disconnect button should disappear (account is null)
    await expect(page.getByText('Disconnect Wallet')).not.toBeVisible({ timeout: 10_000 });

    // Navigate to Wallet via bottom nav to reach onboarding
    await page.getByRole('link', { name: 'Wallet' }).click();

    // Should see the onboarding / CREATE WALLET button
    await expect(page.getByText('CREATE WALLET')).toBeVisible({ timeout: 15_000 });
  });
});
