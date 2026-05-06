import { test, expect } from '@playwright/test';

/**
 * Visual regression tests for zkCoins.
 *
 * Captures screenshots of key UI states and compares against baselines.
 * Run `npx playwright test e2e/visual.spec.ts --update-snapshots` to update baselines.
 */

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

test.describe('Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear wallet state
    await page.evaluate(() => {
      localStorage.clear();
      const dbs = indexedDB.databases
        ? indexedDB.databases().then((dbs: IDBDatabaseInfo[]) =>
            dbs.forEach((db: IDBDatabaseInfo) => {
              if (db.name) indexedDB.deleteDatabase(db.name);
            }),
          )
        : Promise.resolve();
      return dbs;
    });
    await page.reload({ waitUntil: 'networkidle' });
  });

  for (const vp of VIEWPORTS) {
    test(`landing page — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Wait for Create Wallet card to be visible
      await expect(page.getByText('Create Wallet')).toBeVisible();

      await expect(page).toHaveScreenshot(`landing-${vp.name}.png`, {
        maxDiffPixelRatio: 0.01,
        mask: [page.locator('.network-badge')],
      });
    });
  }

  test('seed phrase setup — generate view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Navigate to seed phrase creation
    const seedButton = page.getByRole('button', { name: /seed phrase/i });
    if (await seedButton.isVisible()) {
      await seedButton.click();
    } else {
      await page.getByRole('button', { name: /new wallet/i }).click();
    }

    await expect(page.getByText('Seed Phrase')).toBeVisible();

    await expect(page).toHaveScreenshot('seed-setup-generate.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('seed phrase setup — mnemonic display', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const seedButton = page.getByRole('button', { name: /seed phrase/i });
    if (await seedButton.isVisible()) {
      await seedButton.click();
    } else {
      await page.getByRole('button', { name: /new wallet/i }).click();
    }

    await page.getByRole('button', { name: /generate/i }).click();
    await expect(page.getByText('Your Recovery Phrase')).toBeVisible({ timeout: 10_000 });

    await expect(page).toHaveScreenshot('seed-mnemonic-display.png', {
      maxDiffPixelRatio: 0.01,
      // Mask the actual mnemonic words since they are random
      mask: [page.locator('.grid')],
    });
  });

  test('seed phrase import view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByRole('button', { name: /restore from seed/i }).click();
    await expect(page.getByText('Import Wallet')).toBeVisible();

    await expect(page).toHaveScreenshot('seed-import.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('wallet with balance', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Inject a wallet directly via localStorage (legacy path) for screenshot
    await page.evaluate(() => {
      localStorage.setItem(
        'zkcoins_wallet',
        JSON.stringify({
          account: {
            address: '4a3b2c1d'.repeat(8),
            balance: 25000,
            numPubkeys: 2,
            xpriv: 'xprv9s21ZrQH143K3test',
          },
          transactions: [],
        }),
      );
    });
    await page.reload({ waitUntil: 'networkidle' });

    // Wait for balance display
    await expect(page.getByText('Balance')).toBeVisible({ timeout: 10_000 });

    await expect(page).toHaveScreenshot('wallet-balance.png', {
      maxDiffPixelRatio: 0.01,
      mask: [
        // Mask dynamic content
        page.locator('text=25,000'),
        page.locator('.break-all'), // address display
      ],
    });
  });

  test('send form visible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.evaluate(() => {
      localStorage.setItem(
        'zkcoins_wallet',
        JSON.stringify({
          account: {
            address: '4a3b2c1d'.repeat(8),
            balance: 25000,
            numPubkeys: 2,
            xpriv: 'xprv9s21ZrQH143K3test',
          },
          transactions: [],
        }),
      );
    });
    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.getByText('Send')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('No transactions yet')).toBeVisible();

    await expect(page).toHaveScreenshot('wallet-full.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
      mask: [page.locator('.break-all'), page.locator('text=25,000')],
    });
  });

  test('transaction log with entries', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const now = Date.now();
    await page.evaluate((now) => {
      localStorage.setItem(
        'zkcoins_wallet',
        JSON.stringify({
          account: {
            address: '4a3b2c1d'.repeat(8),
            balance: 15000,
            numPubkeys: 3,
            xpriv: 'xprv9s21ZrQH143K3test',
          },
          transactions: [],
        }),
      );
      localStorage.setItem(
        'zkcoins_transactions',
        JSON.stringify([
          { id: 'tx-1', type: 'mint', amount: 10000, timestamp: now - 3600000 },
          { id: 'tx-2', type: 'mint', amount: 10000, timestamp: now - 1800000 },
          {
            id: 'tx-3',
            type: 'send',
            amount: 5000,
            counterparty: 'deadbeef'.repeat(8),
            timestamp: now - 600000,
          },
        ]),
      );
    }, now);
    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.getByText('Transactions')).toBeVisible({ timeout: 10_000 });

    await expect(page).toHaveScreenshot('transaction-log.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
      mask: [
        page.locator('.break-all'), // addresses
        page.locator('text=15,000'), // balance
        // Mask timestamps
        ...(await page.locator('p.text-xs.text-zkcoins-muted').all()),
      ],
    });
  });
});
