import { test, expect } from '@playwright/test';

/**
 * Visual regression tests for zkCoins.
 *
 * These tests capture screenshots and compare against baselines.
 * Run `npx playwright test e2e/visual.spec.ts --update-snapshots` to generate/update baselines.
 *
 * Note: Baselines are platform-specific (chromium-linux, chromium-darwin).
 * Generate them in the same environment where they will be compared.
 */

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

test.describe('Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear all wallet state
    await page.evaluate(() => {
      localStorage.clear();
      indexedDB
        .databases()
        .then((dbs: IDBDatabaseInfo[]) =>
          dbs.forEach((db: IDBDatabaseInfo) => {
            if (db.name) indexedDB.deleteDatabase(db.name);
          }),
        )
        .catch(() => {});
    });
    await page.reload({ waitUntil: 'networkidle' });
  });

  for (const vp of VIEWPORTS) {
    test(`landing page — ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Create Wallet')).toBeVisible();

      await expect(page).toHaveScreenshot(`landing-${vp.name}.png`, {
        maxDiffPixelRatio: 0.01,
      });
    });
  }

  test('seed phrase setup — generate view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Use specific button text to avoid strict mode violation
    const createSeedButton = page.getByRole('button', { name: 'Create with Seed Phrase' });
    const newWalletButton = page.getByRole('button', { name: /new wallet/i });

    if (await createSeedButton.isVisible()) {
      await createSeedButton.click();
    } else {
      await newWalletButton.click();
    }

    await expect(page.getByText('Seed Phrase')).toBeVisible();

    await expect(page).toHaveScreenshot('seed-setup-generate.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('seed phrase setup — mnemonic display', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const createSeedButton = page.getByRole('button', { name: 'Create with Seed Phrase' });
    const newWalletButton = page.getByRole('button', { name: /new wallet/i });

    if (await createSeedButton.isVisible()) {
      await createSeedButton.click();
    } else {
      await newWalletButton.click();
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

    await page.getByRole('button', { name: 'Restore from Seed Phrase' }).click();
    await expect(page.getByText('Import Wallet')).toBeVisible();

    await expect(page).toHaveScreenshot('seed-import.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});
