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

    await page.goto('/');
    await page.evaluate(async () => {
      localStorage.clear();
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
    });

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

  test('passkey create button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /create with passkey/i })).toBeVisible();
  });

  test('passkey restore button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /restore with passkey/i })).toBeVisible();
  });
});
