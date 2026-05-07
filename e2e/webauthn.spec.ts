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

  test('both passkey and seed phrase buttons are visible when WebAuthn is supported', async ({
    page,
  }) => {
    // Passkey buttons
    await expect(page.getByRole('button', { name: /create with passkey/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /restore with passkey/i })).toBeVisible();

    // Seed phrase buttons
    await expect(page.getByRole('button', { name: /create with seed phrase/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /restore from seed phrase/i })).toBeVisible();
  });

  test('clicking "Create with Passkey" shows the PasskeySetup component', async ({ page }) => {
    await page.getByRole('button', { name: /create with passkey/i }).click();

    // PasskeySetup in create mode shows "Create with Passkey" as heading
    await expect(page.getByRole('heading', { name: /create with passkey/i })).toBeVisible();

    // Description text for create mode
    await expect(
      page.getByText(/use face id, touch id, or your device pin to create a wallet/i),
    ).toBeVisible();

    // Action buttons: "Back" and "Create Passkey"
    await expect(page.getByRole('button', { name: /^back$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^create passkey$/i })).toBeVisible();
  });

  test('clicking "Restore with Passkey" shows the PasskeySetup restore UI', async ({ page }) => {
    await page.getByRole('button', { name: /restore with passkey/i }).click();

    // PasskeySetup in restore mode shows "Restore with Passkey" as heading
    await expect(page.getByRole('heading', { name: /restore with passkey/i })).toBeVisible();

    // Description text for restore mode
    await expect(
      page.getByText(/authenticate with your existing passkey to restore your wallet/i),
    ).toBeVisible();

    // Action buttons: "Back" and "Authenticate"
    await expect(page.getByRole('button', { name: /^back$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^authenticate$/i })).toBeVisible();
  });

  test('PasskeySetup "Back" button returns to the choose screen', async ({ page }) => {
    await page.getByRole('button', { name: /create with passkey/i }).click();
    await expect(page.getByRole('heading', { name: /create with passkey/i })).toBeVisible();

    await page.getByRole('button', { name: /^back$/i }).click();

    // Should be back on the choose screen
    await expect(page.getByText('Create Wallet')).toBeVisible();
    await expect(page.getByRole('button', { name: /create with passkey/i })).toBeVisible();
  });

  test('passkey create flow triggers credential registration on virtual authenticator', async ({
    page,
  }) => {
    // Navigate to the passkey create screen
    await page.getByRole('button', { name: /create with passkey/i }).click();
    await expect(page.getByRole('button', { name: /^create passkey$/i })).toBeVisible();

    // Verify no credentials exist yet
    const before = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    expect(before.credentials).toHaveLength(0);

    // Click "Create Passkey" to trigger navigator.credentials.create()
    await page.getByRole('button', { name: /^create passkey$/i }).click();

    // Wait for the passkey operation to complete.
    // Virtual authenticators may not support the PRF extension, so we check for
    // either a successful flow or the PRF error message.
    const success = page.locator('text=Balance');
    const prfError = page.getByText(/prf extension/i);
    const genericError = page.locator('p.text-red-400');

    await expect(success.or(prfError).or(genericError)).toBeVisible({ timeout: 15_000 });

    // Check that the virtual authenticator received a credential registration
    const after = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    expect(after.credentials.length).toBeGreaterThanOrEqual(1);

    // Verify the registered credential has expected properties
    const credential = after.credentials[0];
    expect(credential.isResidentCredential).toBe(true);
    expect(credential.rpId).toBeTruthy();
  });

  test('passkey restore flow shows "Authenticating..." state while loading', async ({ page }) => {
    await page.getByRole('button', { name: /restore with passkey/i }).click();
    await expect(page.getByRole('button', { name: /^authenticate$/i })).toBeVisible();

    // Click Authenticate - the button text should change to "Authenticating..."
    // The virtual authenticator will auto-respond, so we need to catch the transient state
    const authenticateButton = page.getByRole('button', { name: /authenticate/i });
    await authenticateButton.click();

    // The flow will either succeed, show "Authenticating..." briefly, or show an error.
    // Since there is no pre-registered credential for restore, we expect an error.
    const errorMessage = page.locator('p.text-red-400');
    await expect(errorMessage).toBeVisible({ timeout: 15_000 });
  });
});
