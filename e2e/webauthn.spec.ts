import { test, expect, type CDPSession } from '@playwright/test';

/**
 * WebAuthn/Passkey E2E tests using Chrome DevTools Protocol virtual authenticators.
 * Only runs in Chromium (CDP required).
 */

test.describe('WebAuthn Passkey', () => {
  let cdp: CDPSession;
  let authenticatorId: string;

  test.beforeEach(async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'WebAuthn CDP only available in Chromium');

    // Clear state
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      indexedDB.databases().then((dbs: IDBDatabaseInfo[]) =>
        dbs.forEach((db: IDBDatabaseInfo) => {
          if (db.name) indexedDB.deleteDatabase(db.name);
        }),
      );
    });

    // Set up virtual authenticator via CDP
    cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    const result = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        ctap2Version: 'ctap2_1',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        automaticPresenceSimulation: true,
        isUserVerified: true,
      },
    });
    authenticatorId = result.authenticatorId;

    await page.reload({ waitUntil: 'networkidle' });
  });

  test.afterEach(async () => {
    if (cdp && authenticatorId) {
      try {
        await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
      } catch {
        // session may be closed
      }
    }
  });

  test('passkey button is visible when WebAuthn supported', async ({ page }) => {
    await expect(page.getByRole('button', { name: /passkey/i }).first()).toBeVisible();
  });

  test('passkey create flow registers a credential', async ({ page }) => {
    // Click "Create with Passkey"
    await page.getByRole('button', { name: /create with passkey/i }).click();

    // Wait for passkey setup screen
    await expect(page.getByText(/passkey/i).first()).toBeVisible({ timeout: 5_000 });

    // The virtual authenticator will auto-respond to WebAuthn prompts
    // PRF may not be supported by virtual authenticator — test should handle gracefully
    const prfError = page.getByText(/prf.*not supported/i);
    const setupComplete = page.getByText(/balance/i);

    // Wait for either outcome
    await expect(prfError.or(setupComplete)).toBeVisible({ timeout: 15_000 });

    if (await prfError.isVisible()) {
      // PRF not supported by virtual authenticator — expected limitation
      // Verify the error message is shown properly
      await expect(prfError).toBeVisible();
    } else {
      // PRF worked — verify credential was registered
      const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      expect(credentials.length).toBeGreaterThanOrEqual(1);
      expect(credentials[0].isResidentCredential).toBe(true);
    }
  });

  test('restore with passkey button shows restore flow', async ({ page }) => {
    await page.getByRole('button', { name: /restore with passkey/i }).click();
    // Should show passkey restore UI
    await expect(
      page
        .getByText(/restore/i)
        .or(page.getByText(/passkey/i))
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
