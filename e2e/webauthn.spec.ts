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

  test('passkey create button is visible on passkey screen', async ({ page }) => {
    await page.getByText('CREATE WALLET').click();
    await expect(page.getByRole('button', { name: /register passkey/i })).toBeVisible();
  });

  test('passkey restore button is visible on restore screen', async ({ page }) => {
    await page.getByText('Restore existing wallet').click();
    await expect(page.getByText('RESTORE WITH PASSKEY')).toBeVisible();
  });

  test('both passkey and seed phrase paths are accessible', async ({ page }) => {
    // Create path: Welcome -> CREATE WALLET -> passkey screen (with "OTHER LOGIN OPTIONS" to seed)
    await page.getByText('CREATE WALLET').click();
    await expect(page.getByRole('button', { name: /register passkey/i })).toBeVisible();
    await expect(page.getByText('OTHER LOGIN OPTIONS')).toBeVisible();

    // Go back to welcome
    await page.getByText('Back').click();

    // Restore path: Welcome -> Restore existing wallet -> seed import (with "RESTORE WITH PASSKEY")
    await page.getByText('Restore existing wallet').click();
    await expect(page.getByPlaceholder('Enter your 12 words')).toBeVisible();
    await expect(page.getByText('RESTORE WITH PASSKEY')).toBeVisible();
  });

  test('clicking "Register passkey" triggers the passkey flow', async ({ page }) => {
    await page.getByText('CREATE WALLET').click();
    await expect(page.getByText('Use a passkey')).toBeVisible();
    await expect(page.getByRole('button', { name: /register passkey/i })).toBeVisible();

    // Verify no credentials exist yet
    const before = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    expect(before.credentials).toHaveLength(0);

    // Click register
    await page.getByRole('button', { name: /register passkey/i }).click();

    // Wait for the passkey operation to complete.
    // Virtual authenticators may not support the PRF extension, so we check for
    // either a successful flow or an error message.
    const success = page.locator('text=Balance');
    const prfError = page.getByText(/prf extension/i);
    const genericError = page.locator('.text-bad');

    await expect(success.or(prfError).or(genericError)).toBeVisible({ timeout: 15_000 });

    // Check that the virtual authenticator received a credential registration
    const after = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    expect(after.credentials.length).toBeGreaterThanOrEqual(1);

    const credential = after.credentials[0];
    expect(credential.isResidentCredential).toBe(true);
    expect(credential.rpId).toBeTruthy();
  });

  test('passkey restore flow shows authentication state', async ({ page }) => {
    await page.getByText('Restore existing wallet').click();
    await page.getByText('RESTORE WITH PASSKEY').click();
    await expect(page.getByText('Restore with passkey')).toBeVisible();
    await expect(page.getByRole('button', { name: /authenticate with passkey/i })).toBeVisible();

    // Click Authenticate
    await page.getByRole('button', { name: /authenticate with passkey/i }).click();

    // Since there is no pre-registered credential, we expect an error or the transient state.
    const errorMessage = page.locator('.text-bad');
    const waitingText = page.getByText(/waiting for device/i);
    await expect(errorMessage.or(waitingText)).toBeVisible({ timeout: 15_000 });
  });

  test('Back button returns to previous screen', async ({ page }) => {
    await page.getByText('CREATE WALLET').click();
    await expect(page.getByText('Use a passkey')).toBeVisible();

    await page.getByRole('button', { name: /back/i }).first().click();

    // Should be back on welcome
    await expect(page.getByText('Welcome to zkCoins')).toBeVisible();
    await expect(page.getByText('CREATE WALLET')).toBeVisible();
  });
});
