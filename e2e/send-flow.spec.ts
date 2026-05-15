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
/*  Wallet screen                                                      */
/* ------------------------------------------------------------------ */

test.describe('Wallet Address Display', () => {
  test.beforeEach(async ({ page }) => {
    await createWallet(page);
  });

  test('wallet shows address in {hash}@zkcoins.app format', async ({ page }) => {
    await expect(page.locator('text=/[0-9a-f]{8}@zkcoins\\.app/').first()).toBeVisible();
  });

  test('claim username input is visible for unclaimed accounts', async ({ page }) => {
    const claimInput = page.locator('input[placeholder="Claim a username"]');
    await expect(claimInput).toBeVisible();
    await expect(page.getByRole('button', { name: 'Claim' })).toBeVisible();
  });

  test('no raw 64-char hex strings visible in wallet view', async ({ page }) => {
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toMatch(/[0-9a-f]{64}/);
  });

  test('send and receive buttons are visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Send' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Receive' }).first()).toBeVisible();
  });

  test('faucet button visible in empty wallet banner', async ({ page }) => {
    // New wallet has zero balance, so the empty wallet banner with Faucet should show.
    // Both assertions race the post-create balance polling tick that fetches
    // `/api/balance` for the freshly-derived address. On a quiet DEV server
    // that tick returns 0 quickly and the banner is up immediately; under
    // load the round-trip can stretch past 10 s, so use 30 s on both.
    await expect(page.getByText('Wallet is empty')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Faucet' })).toBeVisible({ timeout: 30_000 });
  });

  test('transaction list shows "No transactions yet" for new wallet', async ({ page }) => {
    await expect(page.getByText('No transactions yet')).toBeVisible();
  });
});

/* ------------------------------------------------------------------ */
/*  Send page (navigate via app UI)                                    */
/* ------------------------------------------------------------------ */

test.describe('Send Page', () => {
  test.beforeEach(async ({ page }) => {
    await createWallet(page);
    // Navigate via the app's Send link, not page.goto
    await page.getByRole('link', { name: 'Send' }).click();
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

  test('back link is visible', async ({ page }) => {
    await expect(page.getByText('Back')).toBeVisible();
  });
});

/* ------------------------------------------------------------------ */
/*  Receive page (navigate via app UI)                                 */
/* ------------------------------------------------------------------ */

test.describe('Receive Page', () => {
  test.beforeEach(async ({ page }) => {
    await createWallet(page);
    // Navigate via the app's Receive link (first one is the main button)
    await page.getByRole('link', { name: 'Receive' }).first().click();
    await expect(page.getByText('Receive Bitcoin')).toBeVisible({ timeout: 15_000 });
  });

  test('address is displayed in {hash}@zkcoins.app format', async ({ page }) => {
    await expect(page.locator('text=/[0-9a-f]{8}@zkcoins\\.app/').first()).toBeVisible();
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
});
