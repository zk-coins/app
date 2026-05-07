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
      await expect(page.getByText('Welcome to zkCoins')).toBeVisible();

      // Screenshot baselines need regeneration after redesign.
      // Run with --update-snapshots to create new baselines.
      await expect(page).toHaveScreenshot(`landing-${vp.name}.png`, {
        maxDiffPixelRatio: 0.05,
      });
    });
  }

  test('seed phrase setup — generate view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByText('CREATE WALLET').click();
    await page.getByText('OTHER LOGIN OPTIONS').click();
    await expect(page.getByText('Your seed phrase')).toBeVisible({ timeout: 15_000 });

    await expect(page).toHaveScreenshot('seed-setup-generate.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('seed phrase setup — mnemonic display', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByText('CREATE WALLET').click();
    await page.getByText('OTHER LOGIN OPTIONS').click();
    await expect(page.getByText('Your seed phrase')).toBeVisible({ timeout: 15_000 });

    await page.getByText('Tap to reveal').click();
    await expect(page.locator('.grid > div').first()).toBeVisible();

    await expect(page).toHaveScreenshot('seed-mnemonic-display.png', {
      maxDiffPixelRatio: 0.05,
      mask: [page.locator('.grid')],
    });
  });

  test('seed phrase import view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByText('Restore existing wallet').click();
    await expect(page.getByText('Restore wallet')).toBeVisible();

    await expect(page).toHaveScreenshot('seed-import.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});
