import { test, expect } from '@playwright/test';

test.describe('Wallet', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
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
  });

  test('loads landing page with wallet creation options', async ({ page }) => {
    await expect(page.getByText('Welcome to zkCoins')).toBeVisible();
    await expect(page.getByText('CREATE WALLET')).toBeVisible();
    await expect(page.getByText('Restore existing wallet')).toBeVisible();
  });

  test('navigates to seed phrase creation', async ({ page }) => {
    // Welcome -> Create Wallet -> Passkey screen -> OTHER LOGIN OPTIONS -> Seed
    await page.getByText('CREATE WALLET').click();
    await expect(page.getByText('Use a passkey')).toBeVisible();
    await page.getByText('OTHER LOGIN OPTIONS').click();
    await expect(page.getByText('Your seed phrase')).toBeVisible();
  });

  test('navigates to seed phrase import', async ({ page }) => {
    await page.getByText('Restore existing wallet').click();
    await expect(page.getByText('Restore wallet')).toBeVisible();
    await expect(page.getByPlaceholder('Enter your 12 words')).toBeVisible();
  });

  test('generates 12-word mnemonic', async ({ page }) => {
    await page.getByText('CREATE WALLET').click();
    await page.getByText('OTHER LOGIN OPTIONS').click();
    await expect(page.getByText('Your seed phrase')).toBeVisible({ timeout: 15_000 });
    // Tap to reveal the words
    await page.getByText('Tap to reveal').click();
    const words = await page.locator('.grid > div').count();
    expect(words).toBe(12);
  });

  test('header shows branding', async ({ page }) => {
    await expect(page.getByText('Welcome to zkCoins')).toBeVisible();
    await expect(page.getByText(/Shielded CSV/)).toBeVisible();
  });

  test('footer has navigation links', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Docs' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'GitHub' })).toBeVisible();
  });
});
