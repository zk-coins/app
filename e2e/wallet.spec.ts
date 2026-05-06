import { test, expect } from '@playwright/test';

test.describe('Wallet', () => {
  test.setTimeout(120_000);
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear all storage (localStorage + IndexedDB)
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

  test('creates wallet via seed phrase flow', async ({ page }) => {
    const apiCalls: { url: string; method: string; body?: string }[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/')) {
        apiCalls.push({ url: req.url(), method: req.method(), body: req.postData() ?? undefined });
      }
    });

    // Step 1: Start seed phrase flow
    await page.getByText('Create with Seed Phrase').click();

    // Step 2: Generate seed phrase
    await expect(page.getByText('Seed Phrase')).toBeVisible();
    await page.getByRole('button', { name: 'Generate' }).click();

    // Step 3: Should show 12 words
    await expect(page.getByText('Your Recovery Phrase')).toBeVisible({ timeout: 15_000 });
    const wordElements = page.locator('.grid > div');
    await expect(wordElements).toHaveCount(12, { timeout: 10_000 });

    // Capture words
    const words: string[] = [];
    for (let i = 0; i < 12; i++) {
      const text = await wordElements.nth(i).textContent();
      const word = text?.replace(/^\d+\.\s*/, '').trim();
      if (word) words.push(word);
    }
    expect(words).toHaveLength(12);

    // Step 4: Confirm
    await page.getByText('I wrote it down').click();
    await expect(page.getByText('Confirm Recovery Phrase')).toBeVisible();
    await page.locator('textarea').fill(words.join(' '));
    await page.getByRole('button', { name: 'Confirm' }).click();

    // Step 5: Set password
    await expect(page.getByText('Set Unlock Password')).toBeVisible({ timeout: 15_000 });
    await page.locator('input[placeholder*="min"]').fill('testpass123');
    await page.locator('input[placeholder*="Confirm"]').fill('testpass123');
    await page.getByText('Encrypt & Save').click();

    // Step 6: Should show balance view with address
    await expect(page.getByText('Balance')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Send Coins')).toBeVisible();
  });

  test('WASM module loads during wallet creation', async ({ page }) => {
    await page.getByText('Create with Seed Phrase').click();
    await page.getByRole('button', { name: 'Generate' }).click();

    // Wait for WASM to load and generate the mnemonic
    await expect(page.getByText('Your Recovery Phrase')).toBeVisible({ timeout: 15_000 });

    const wasmLoaded = await page.evaluate(() => {
      const perf = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return perf.some((e) => e.name.includes('.wasm'));
    });
    expect(wasmLoaded).toBe(true);
  });

  test('wallet persists after page reload via unlock', async ({ page }) => {
    // Create wallet
    await page.getByText('Create with Seed Phrase').click();
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page.getByText('Your Recovery Phrase')).toBeVisible({ timeout: 15_000 });

    const wordElements = page.locator('.grid > div');
    await expect(wordElements).toHaveCount(12, { timeout: 10_000 });
    const words: string[] = [];
    for (let i = 0; i < 12; i++) {
      const text = await wordElements.nth(i).textContent();
      const word = text?.replace(/^\d+\.\s*/, '').trim();
      if (word) words.push(word);
    }

    await page.getByText('I wrote it down').click();
    await page.locator('textarea').fill(words.join(' '));
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText('Set Unlock Password')).toBeVisible({ timeout: 15_000 });
    await page.locator('input[placeholder*="min"]').fill('testpass123');
    await page.locator('input[placeholder*="Confirm"]').fill('testpass123');
    await page.getByText('Encrypt & Save').click();

    await expect(page.getByText('Balance')).toBeVisible({ timeout: 60_000 });

    // Reload — should show unlock screen
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText('Unlock Wallet')).toBeVisible({ timeout: 10_000 });

    // Unlock with password
    await page.locator('input[type="password"]').fill('testpass123');
    await page.getByRole('button', { name: 'Unlock' }).click();

    // Should show balance again
    await expect(page.getByText('Balance')).toBeVisible({ timeout: 15_000 });
  });
});
