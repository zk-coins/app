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
    await expect(page.getByText('Create Wallet')).toBeVisible();
    await expect(page.getByText('Create with Seed Phrase')).toBeVisible();
    await expect(page.getByText('Restore from Seed Phrase')).toBeVisible();
  });

  test('navigates to seed phrase creation', async ({ page }) => {
    await page.getByText('Create with Seed Phrase').click();
    await expect(page.getByText('Seed Phrase')).toBeVisible();
    await expect(page.getByRole('button', { name: /generate/i })).toBeVisible();
  });

  test('navigates to seed phrase import', async ({ page }) => {
    await page.getByText('Restore from Seed Phrase').click();
    await expect(page.getByText('Import Wallet')).toBeVisible();
  });

  test('generates 12-word mnemonic', async ({ page }) => {
    await page.getByText('Create with Seed Phrase').click();
    await page.getByRole('button', { name: /generate/i }).click();
    await expect(page.getByText('Your Recovery Phrase')).toBeVisible({ timeout: 15_000 });
    const words = await page.locator('.grid > div').count();
    expect(words).toBe(12);
  });

  test('header shows branding', async ({ page }) => {
    await expect(page.getByText('zkCoins')).toBeVisible();
    await expect(page.getByText('Shielded CSV Wallet')).toBeVisible();
  });

  test('footer has navigation links', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Docs' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'GitHub' })).toBeVisible();
  });
});
