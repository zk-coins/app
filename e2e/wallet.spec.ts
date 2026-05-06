import { test, expect } from '@playwright/test';

test.describe('Wallet', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear all storage (localStorage + IndexedDB)
    await page.evaluate(async () => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('zkcoins'))
        .forEach((k) => localStorage.removeItem(k));
      // Clear IndexedDB
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    });
    await page.reload({ waitUntil: 'networkidle' });
  });

  test('loads landing page with wallet creation options', async ({ page }) => {
    await expect(page.getByText('Create Wallet')).toBeVisible();
    // Should have at least the seed phrase option
    await expect(page.getByRole('button', { name: /seed phrase|new wallet/i })).toBeVisible();
    // Should have restore option
    await expect(page.getByRole('button', { name: /restore from seed/i })).toBeVisible();
  });

  test('creates wallet via seed phrase flow', async ({ page }) => {
    // Track API requests
    const apiCalls: { url: string; method: string; body?: string; status?: number }[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/')) {
        apiCalls.push({ url: req.url(), method: req.method(), body: req.postData() ?? undefined });
      }
    });

    // Step 1: Click "Create with Seed Phrase" or "New Wallet"
    const seedButton = page.getByRole('button', { name: /seed phrase|new wallet/i }).first();
    await seedButton.click();

    // Step 2: Generate seed phrase
    await expect(page.getByText('Seed Phrase')).toBeVisible();
    await page.getByRole('button', { name: /generate/i }).click();

    // Step 3: Should show 12 words
    await expect(page.getByText('Recovery Phrase')).toBeVisible();
    const wordElements = page.locator('.grid > div');
    await expect(wordElements).toHaveCount(12, { timeout: 10_000 });

    // Capture the 12 words
    const words: string[] = [];
    for (let i = 0; i < 12; i++) {
      const text = await wordElements.nth(i).textContent();
      // Format: "1. word" — extract just the word
      const word = text?.replace(/^\d+\.\s*/, '').trim();
      if (word) words.push(word);
    }
    expect(words).toHaveLength(12);

    // Step 4: Click "I wrote it down"
    await page.getByRole('button', { name: /wrote it down/i }).click();

    // Step 5: Confirm by entering the words
    await expect(page.getByText('Confirm Recovery Phrase')).toBeVisible();
    await page.getByRole('textbox').fill(words.join(' '));
    await page.getByRole('button', { name: /confirm/i }).click();

    // Step 6: Set password
    await expect(page.getByText('Set Unlock Password')).toBeVisible({ timeout: 10_000 });
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill('testpass123');
    await passwordInputs.nth(1).fill('testpass123');
    await page.getByRole('button', { name: /encrypt|save/i }).click();

    // Step 7: Should show balance view
    await expect(page.getByText('Balance')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Address')).toBeVisible();

    // Verify mint API was called
    const mintCall = apiCalls.find((c) => c.url.includes('/api/mint'));
    expect(mintCall).toBeDefined();
    expect(mintCall!.method).toBe('POST');
  });

  test('WASM module loads during wallet creation', async ({ page }) => {
    // Start seed phrase flow
    const seedButton = page.getByRole('button', { name: /seed phrase|new wallet/i }).first();
    await seedButton.click();
    await page.getByRole('button', { name: /generate/i }).click();

    // Check that WASM was loaded
    const wasmLoaded = await page.evaluate(() => {
      const perf = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return perf.some((e) => e.name.includes('.wasm'));
    });
    expect(wasmLoaded).toBe(true);
  });

  test('wallet persists after page reload via unlock', async ({ page }) => {
    // Create wallet first (abbreviated — just get to balance view)
    const seedButton = page.getByRole('button', { name: /seed phrase|new wallet/i }).first();
    await seedButton.click();
    await page.getByRole('button', { name: /generate/i }).click();
    await expect(page.getByText('Recovery Phrase')).toBeVisible();

    const wordElements = page.locator('.grid > div');
    await expect(wordElements).toHaveCount(12, { timeout: 10_000 });
    const words: string[] = [];
    for (let i = 0; i < 12; i++) {
      const text = await wordElements.nth(i).textContent();
      const word = text?.replace(/^\d+\.\s*/, '').trim();
      if (word) words.push(word);
    }

    await page.getByRole('button', { name: /wrote it down/i }).click();
    await page.getByRole('textbox').fill(words.join(' '));
    await page.getByRole('button', { name: /confirm/i }).click();

    await expect(page.getByText('Set Unlock Password')).toBeVisible({ timeout: 10_000 });
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill('testpass123');
    await passwordInputs.nth(1).fill('testpass123');
    await page.getByRole('button', { name: /encrypt|save/i }).click();

    await expect(page.getByText('Balance')).toBeVisible({ timeout: 30_000 });

    // Reload page — should show unlock screen
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText('Unlock Wallet')).toBeVisible({ timeout: 10_000 });

    // Enter password to unlock
    await page.locator('input[type="password"]').fill('testpass123');
    await page.getByRole('button', { name: /unlock/i }).click();

    // Should show balance again
    await expect(page.getByText('Balance')).toBeVisible({ timeout: 15_000 });
  });
});
