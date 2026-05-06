import { test, expect } from '@playwright/test';

test.describe('Wallet', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('zkcoins'))
        .forEach((k) => localStorage.removeItem(k));
    });
    await page.reload({ waitUntil: 'networkidle' });
  });

  test('loads landing page with Create Account button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
    await expect(page.getByText('Create Wallet')).toBeVisible();
  });

  test('creates account with real WASM crypto', async ({ page }) => {
    // Track API requests
    const apiCalls: { url: string; method: string; body?: string; status?: number }[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/')) {
        apiCalls.push({ url: req.url(), method: req.method(), body: req.postData() ?? undefined });
      }
    });
    page.on('response', (res) => {
      const call = apiCalls.find(
        (c) => c.url === res.url() && c.method === res.request().method() && !c.status,
      );
      if (call) call.status = res.status();
    });

    await page.getByRole('button', { name: /create account/i }).click();

    // Wait for account creation (WASM init + key generation + API call attempt)
    await expect(page.getByText('Balance')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Address')).toBeVisible();

    // Verify xpriv was stored in localStorage (WASM generated real keys)
    const walletData = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('zkcoins_wallet_'));
      return key ? JSON.parse(localStorage.getItem(key)!) : null;
    });
    expect(walletData).not.toBeNull();
    expect(walletData.account.xpriv).toContain('xprv');
    expect(walletData.account.address).toMatch(/^[0-9a-f]{64}$/);
    expect(walletData.account.numPubkeys).toBe(0);

    // Verify mint API was called with correct field names
    const mintCall = apiCalls.find((c) => c.url.includes('/api/mint'));
    expect(mintCall).toBeDefined();
    expect(mintCall!.method).toBe('POST');
    const mintBody = JSON.parse(mintCall!.body!);
    expect(mintBody.account_address).toMatch(/^[0-9a-f]{64}$/);
    expect(mintBody.amount).toBe(10_000);
  });

  test('WASM module loads on account creation', async ({ page }) => {
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByText('Balance')).toBeVisible({ timeout: 15_000 });

    const wasmLoaded = await page.evaluate(() => {
      const perf = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return perf.some((e) => e.name.includes('.wasm'));
    });
    expect(wasmLoaded).toBe(true);
  });

  test('faucet button calls mint API', async ({ page }) => {
    // Create account first
    const apiCalls: { url: string; method: string; body?: string }[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/')) {
        apiCalls.push({ url: req.url(), method: req.method(), body: req.postData() ?? undefined });
      }
    });

    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByText('Balance')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);

    // Reset tracking for faucet click
    const callsBefore = apiCalls.length;
    await page.getByRole('button', { name: /faucet/i }).click();
    await page.waitForTimeout(3000);

    // Verify faucet triggered another mint call
    const faucetCalls = apiCalls.slice(callsBefore);
    const faucetMint = faucetCalls.find((c) => c.url.includes('/api/mint'));
    expect(faucetMint).toBeDefined();
    expect(faucetMint!.method).toBe('POST');
    const body = JSON.parse(faucetMint!.body!);
    expect(body.account_address).toMatch(/^[0-9a-f]{64}$/);
  });
});
