/**
 * Spec 13 — Send Bitcoin: server `ApiError` → localised toast (issue #99).
 *
 * The Jobs API (node PR #161) admits a send at `POST /api/jobs/send` and
 * verifies the signed request synchronously before enqueueing: a bad
 * request (unknown account, insufficient funds, bad signature) 4xx/5xxs
 * at admit with the `{error: "<string>"}` envelope (`JobErrorResponse`).
 * The app maps each known server-error string to a translated
 * user-facing message via `src/lib/api/errorMessages.ts::userMessageFor`.
 *
 * These specs assert the end-to-end pipeline (fetch → `ApiError` →
 * `userMessageFor` → `send-error` toast) by intercepting the admit route
 * `/api/jobs/send` with a `page.route()` mock that returns a
 * deterministic structured failure — so they do NOT depend on the
 * `awaiting_signature` proof path (and therefore not on node #195).
 *
 * The mock fires *after* the local WASM signing path has completed, so
 * the UI settles cleanly on the error state before we capture the shot.
 *
 * Locator strategy: testid-based on `send-error`. Each known server
 * string asserts both the *text* (the active-locale translation; the E2E
 * build pins `NEXT_PUBLIC_E2E_LOCALE=en`) and a screenshot baseline. The
 * fallback path (unmapped 418) is text-only — a regression guard for the
 * `Server error <status>: <raw>` shape.
 */

import { expect, test, type Page } from '@playwright/test';
import { readAccounts, aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

async function aliceGoToSend(page: Page): Promise<void> {
  await aliceLogin(page);
  await page.getByTestId('wallet-send-btn').click();
  await expect(page.getByTestId('send-heading')).toBeVisible({ timeout: 10_000 });
}

/**
 * Install a `/api/jobs/send` admit-route handler that returns a
 * structured `4xx|5xx + {error}` body, exactly as the node's Jobs API
 * emits when it rejects a send before enqueueing.
 *
 * Registered at the context level (not page-level) and matched via
 * regex on the URL pathname — bullet-proof against cross-origin and
 * any future SW-pass-through edge case.
 */
async function mockSendError(page: Page, status: number, error: string): Promise<void> {
  await page.context().route(/\/api\/jobs\/send$/, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ error }),
    }),
  );
}

async function aliceSubmitSend(page: Page): Promise<void> {
  const { bob } = readAccounts();
  await aliceGoToSend(page);
  await page.getByTestId('send-recipient-input').fill(bob.address);
  await page.getByTestId('send-amount-input').fill('0.00001');
  await page.getByTestId('send-submit-btn').click();
  await expect(page.getByTestId('send-confirm-card')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('send-confirm-btn').click();
}

// Block service-worker registration for this file. The zkCoins PWA worker
// caches/passes-through `/api/jobs/send` traffic before `page.route()`
// gets a chance — without this the real DEV response can leak past the
// mock. Blocking SW takes the worker out of the request path entirely so
// the mock is the only response handler.
test.use({ serviceWorkers: 'block' });

test.describe('Send Bitcoin — server error toasts (issue #99)', () => {
  test('insufficient-funds-toast', async ({ page }) => {
    await setViewport(page, 'mobile');
    await mockSendError(page, 422, 'Insufficient funds');
    await aliceSubmitSend(page);
    await expect(page.getByTestId('send-error')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('send-error')).toHaveText(
      /Nicht genug Guthaben für diese Überweisung\./,
    );
    await snap(page, '13-server-error-insufficient-funds', {
      mask: [page.getByTestId('send-recipient-input')],
    });
  });

  test('unknown-account-toast', async ({ page }) => {
    await setViewport(page, 'mobile');
    await mockSendError(page, 404, 'Unknown account address');
    await aliceSubmitSend(page);
    await expect(page.getByTestId('send-error')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('send-error')).toHaveText(
      /Dieser Account ist auf dem Server nicht bekannt\./,
    );
    await snap(page, '13-server-error-unknown-account', {
      mask: [page.getByTestId('send-recipient-input')],
    });
  });

  test('prove-failed-toast', async ({ page }) => {
    await setViewport(page, 'mobile');
    await mockSendError(page, 500, 'prove failed');
    await aliceSubmitSend(page);
    await expect(page.getByTestId('send-error')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('send-error')).toHaveText(
      /Beweisgenerierung fehlgeschlagen\. Bitte später erneut versuchen\./,
    );
    await snap(page, '13-server-error-prove-failed', {
      mask: [page.getByTestId('send-recipient-input')],
    });
  });

  test('unmapped-server-error-falls-back (no shot)', async ({ page }) => {
    // Unmapped strings produce the `Serverfehler <status>: <raw>`
    // fallback so the user is never left with a stringly-typed
    // `Error.message` blob like the pre-#99 toast. Text-only —
    // visual identical to the mapped cases.
    await setViewport(page, 'mobile');
    await mockSendError(page, 418, "I'm a teapot");
    await aliceSubmitSend(page);
    await expect(page.getByTestId('send-error')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('send-error')).toHaveText(/Serverfehler 418: I'm a teapot/);
  });
});
