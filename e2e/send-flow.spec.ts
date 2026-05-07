import { test, expect, type Page } from '@playwright/test';

/**
 * Helper: create a wallet via the seed phrase flow so authenticated
 * pages (/send, /receive) can be tested.
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

  // Welcome -> CREATE WALLET -> passkey screen -> OTHER LOGIN OPTIONS -> seed phrase
  await page.getByText('CREATE WALLET').click();
  await page.getByText('OTHER LOGIN OPTIONS').click();
  await expect(page.getByText('Your seed phrase')).toBeVisible({ timeout: 15_000 });

  // Reveal -> confirm -> password
  await page.getByText('Tap to reveal').click();
  await page.getByText("I've written it down").click();
  await page.getByText('Continue').click();

  // Set password
  const passwordInputs = page.locator('input[type="password"]');
  await passwordInputs.first().fill('TestPassword123!');
  await passwordInputs.last().fill('TestPassword123!');
  await page.getByText('Create wallet').click();

  // Wait for wallet to be fully loaded.
  await expect(page.getByText('Balance')).toBeVisible({ timeout: 15_000 });
}

/* ------------------------------------------------------------------ */
/*  Send page UI                                                       */
/* ------------------------------------------------------------------ */

test.describe('Send Page', () => {
  test.beforeEach(async ({ page }) => {
    await createWallet(page);
    await page.goto('/send');
    await expect(page.getByText('Send Bitcoin')).toBeVisible({ timeout: 15_000 });
  });

  test('recipient placeholder is alice@zkcoins.app', async ({ page }) => {
    const recipientInput = page.locator('input[placeholder="alice@zkcoins.app"]');
    await expect(recipientInput).toBeVisible();
  });

  test('send button is disabled without recipient and amount', async ({ page }) => {
    const sendButton = page.getByRole('button', { name: 'Send privately' });
    await expect(sendButton).toBeVisible();
    await expect(sendButton).toBeDisabled();
  });

  test('shows no-funds banner when balance is 0', async ({ page }) => {
    await expect(page.getByText('No funds to send.')).toBeVisible();
  });

  test('"Set max" button fills the amount field', async ({ page }) => {
    await page.getByText('Set max').click();
    const amountInput = page.locator('input[placeholder="0.00000000"]');
    const value = await amountInput.inputValue();
    // Balance is 0 for a fresh wallet, so max should be "0.00000000".
    expect(value).toBe('0.00000000');
  });

  test('available balance box is visible', async ({ page }) => {
    await expect(page.getByText('Available')).toBeVisible();
    await expect(page.getByText('BTC', { exact: false })).toBeVisible();
  });

  test('back link navigates to wallet', async ({ page }) => {
    await page.getByText('Back').click();
    await expect(page.getByText('Balance')).toBeVisible({ timeout: 10_000 });
  });
});

/* ------------------------------------------------------------------ */
/*  Receive page UI                                                    */
/* ------------------------------------------------------------------ */

test.describe('Receive Page', () => {
  test.beforeEach(async ({ page }) => {
    await createWallet(page);
    await page.goto('/receive');
    await expect(page.getByText('Receive Bitcoin')).toBeVisible({ timeout: 15_000 });
  });

  test('address is displayed in {hash}@zkcoins.app format', async ({ page }) => {
    const addressElement = page.locator('text=/[0-9a-f]{8}@zkcoins\\.app/');
    await expect(addressElement).toBeVisible();
  });

  test('QR code is visible', async ({ page }) => {
    const qrCode = page.locator('svg').filter({ has: page.locator('rect') });
    await expect(qrCode.first()).toBeVisible();
  });

  test('copy button exists', async ({ page }) => {
    await expect(page.getByText('Copy address')).toBeVisible();
  });

  test('no raw 64-char hex visible on page', async ({ page }) => {
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toMatch(/[0-9a-f]{64}/);
  });

  test('"Your address" label is present', async ({ page }) => {
    await expect(page.getByText('Your address')).toBeVisible();
  });

  test('back link navigates to wallet', async ({ page }) => {
    await page.getByText('Back').click();
    await expect(page.getByText('Balance')).toBeVisible({ timeout: 10_000 });
  });
});

/* ------------------------------------------------------------------ */
/*  Wallet screen username & address display                           */
/* ------------------------------------------------------------------ */

test.describe('Wallet Address Display', () => {
  test.beforeEach(async ({ page }) => {
    await createWallet(page);
  });

  test('wallet shows address in {hash}@zkcoins.app format', async ({ page }) => {
    const addressElement = page.locator('text=/[0-9a-f]{8}@zkcoins\\.app/');
    await expect(addressElement).toBeVisible();
  });

  test('claim username input is visible for unclaimed accounts', async ({ page }) => {
    const claimInput = page.locator('input[placeholder="Claim a username"]');
    await expect(claimInput).toBeVisible();
    await expect(page.getByRole('button', { name: 'Claim' })).toBeVisible();
  });

  test('no raw 64-char hex strings visible in wallet view', async ({ page }) => {
    // The wallet card area should not contain raw hex addresses.
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toMatch(/[0-9a-f]{64}/);
  });

  test('send and receive buttons are visible', async ({ page }) => {
    await expect(page.getByText('Send')).toBeVisible();
    await expect(page.getByText('Receive')).toBeVisible();
  });
});
