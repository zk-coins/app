import { test, expect } from '@playwright/test';

test.describe('Address Format', () => {
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

  test('send form placeholder uses zkcoins.app format', async ({ page }) => {
    // Create a wallet first so the send form appears
    await page.getByText('Create with Seed Phrase').click();
    await page.getByRole('button', { name: /generate/i }).click();
    await expect(page.getByText('Your Recovery Phrase')).toBeVisible({ timeout: 15_000 });

    // Confirm the seed phrase
    await page.getByRole('button', { name: /saved/i }).click();

    // Set password
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill('TestPassword123!');
    await passwordInputs.last().fill('TestPassword123!');
    await page.getByRole('button', { name: /set password/i }).click();

    // Wait for wallet to be created and send form to appear
    await expect(page.getByText('Send')).toBeVisible({ timeout: 15_000 });

    // Check the recipient placeholder
    const recipientInput = page.locator('input[placeholder="alice@zkcoins.app"]');
    await expect(recipientInput).toBeVisible();
  });

  test('wallet shows address in @zkcoins.app format', async ({ page }) => {
    // Create a wallet
    await page.getByText('Create with Seed Phrase').click();
    await page.getByRole('button', { name: /generate/i }).click();
    await expect(page.getByText('Your Recovery Phrase')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /saved/i }).click();

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill('TestPassword123!');
    await passwordInputs.last().fill('TestPassword123!');
    await page.getByRole('button', { name: /set password/i }).click();

    // Wait for wallet card to show
    await expect(page.getByText('Balance')).toBeVisible({ timeout: 15_000 });

    // Address should be displayed as {hash}@zkcoins.app (8 hex chars + @zkcoins.app)
    const addressElement = page.locator('text=/[0-9a-f]{8}@zkcoins\\.app/');
    await expect(addressElement).toBeVisible();
  });

  test('address format does not show raw hex', async ({ page }) => {
    // Create a wallet
    await page.getByText('Create with Seed Phrase').click();
    await page.getByRole('button', { name: /generate/i }).click();
    await expect(page.getByText('Your Recovery Phrase')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /saved/i }).click();

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill('TestPassword123!');
    await passwordInputs.last().fill('TestPassword123!');
    await page.getByRole('button', { name: /set password/i }).click();

    await expect(page.getByText('Balance')).toBeVisible({ timeout: 15_000 });

    // The raw 64-char hex address should NOT be visible as-is
    const addressSection = page.locator('.rounded-lg.bg-zkcoins-bg');
    const addressText = await addressSection.textContent();
    // Should contain @zkcoins.app format, not a full 64-char hex string
    expect(addressText).toContain('@zkcoins.app');
    expect(addressText).not.toMatch(/[0-9a-f]{64}/);
  });

  test('username claim input is visible for new wallets', async ({ page }) => {
    // Create a wallet
    await page.getByText('Create with Seed Phrase').click();
    await page.getByRole('button', { name: /generate/i }).click();
    await expect(page.getByText('Your Recovery Phrase')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /saved/i }).click();

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill('TestPassword123!');
    await passwordInputs.last().fill('TestPassword123!');
    await page.getByRole('button', { name: /set password/i }).click();

    await expect(page.getByText('Balance')).toBeVisible({ timeout: 15_000 });

    // Custom name input and claim button should be visible
    const customNameInput = page.locator('input[placeholder="Custom name"]');
    await expect(customNameInput).toBeVisible();
    await expect(page.getByRole('button', { name: 'Claim' })).toBeVisible();
  });
});
