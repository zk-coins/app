/**
 * Spec 10 — Install as PWA
 *
 * Covers § 8.10 of e2e/README.md. PwaPrompt has three detection modes
 * (native / ios / manual) plus the "installing…" sub-state of native.
 * 4 tests, 4 baselines.
 *
 * Closes the MVP triage gap for "Install as PWA": before this spec, the
 * component had no functional coverage at all.
 *
 * DEV-only widgets visible in these baselines (per § 8.0 (b)):
 *   - Apps tab in BottomNav
 *   - Faucet button on WalletScreen (Alice's balance is funded by globalSetup)
 *
 * Isolation notes
 *   - PwaPrompt reads `localStorage["zkcoins_pwa_prompt_dismissed"]`. We
 *     clear it via `addInitScript` so previous runs can't suppress the
 *     card.
 *   - PwaPrompt's BIP listener is only attached after WalletScreen mounts,
 *     so we dispatch the synthetic `beforeinstallprompt` event AFTER
 *     `aliceLogin` returns (rather than from an init script). This avoids
 *     racing the listener.
 *   - iOS / manual modes are pure UA branches — no BIP dispatch needed.
 *     The iOS UA is set via `test.use({ userAgent })` so PwaPrompt's
 *     mount-time `detectMode()` sees the override.
 *
 * Locators: testid-based. Mode detection asserts on the three Card
 * variants (`pwa-prompt-ios`, `pwa-prompt-native`, `pwa-prompt-manual`)
 * rather than literal copy.
 */

import { expect, test, type Page } from '@playwright/test';
import { aliceLogin } from './_helpers/fixtures';
import { snap, setViewport } from './_helpers/screenshot';

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

const CLEAR_DISMISSED_FLAG = `
  try { localStorage.removeItem('zkcoins_pwa_prompt_dismissed'); } catch (e) {}
`;

/**
 * Dispatch a synthetic `beforeinstallprompt` event with controllable
 * `prompt()` delay. Called AFTER WalletScreen has mounted so the
 * component's React listener is in place.
 */
async function dispatchBeforeInstallPrompt(page: Page, promptDelayMs: number): Promise<void> {
  await page.evaluate((delay) => {
    const evt = new Event('beforeinstallprompt') as Event & {
      prompt?: () => Promise<void>;
      userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
    };
    evt.prompt = () => new Promise((r) => setTimeout(r, delay));
    evt.userChoice = new Promise((r) => setTimeout(() => r({ outcome: 'accepted' }), delay));
    window.dispatchEvent(evt);
  }, promptDelayMs);
}

test.describe('PwaPrompt — native mode', () => {
  test.beforeEach(async ({ page }) => {
    await setViewport(page, 'mobile');
    await page.addInitScript({ content: CLEAR_DISMISSED_FLAG });
    await aliceLogin(page);
    // Wait for Alice's balance-poll tick so the wallet behind the
    // PwaPrompt card is funded. Without this the PwaPrompt baselines
    // capture the pre-tick empty-banner state and `pwa-manual-mode`
    // collapses onto `06-balance-zero-empty-banner`.
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
  });

  test('pwa-native-mode', async ({ page }) => {
    await dispatchBeforeInstallPrompt(page, 50);
    await expect(page.getByTestId('pwa-install-btn')).toBeVisible({ timeout: 5_000 });
    await snap(page, '10-pwa-native-mode', { fullPage: true });
  });

  test('pwa-native-installing', async ({ page }) => {
    // Long delay so we can baseline the "Installing…" disabled state.
    await dispatchBeforeInstallPrompt(page, 5_000);
    await expect(page.getByTestId('pwa-install-btn')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('pwa-install-btn').click();
    const btn = page.getByTestId('pwa-install-btn');
    await expect(btn).toHaveAttribute('data-installing', 'true', { timeout: 2_000 });
    await expect(btn).toBeDisabled();
    await snap(page, '10-pwa-native-installing', { fullPage: true });
  });
});

test.describe('PwaPrompt — iOS Safari', () => {
  test.use({ userAgent: IOS_UA });

  test.beforeEach(async ({ page }) => {
    await setViewport(page, 'mobile');
    await page.addInitScript({ content: CLEAR_DISMISSED_FLAG });
    await aliceLogin(page);
    // Wait for Alice's balance-poll tick so the wallet behind the
    // PwaPrompt card is funded. Without this the PwaPrompt baselines
    // capture the pre-tick empty-banner state and `pwa-manual-mode`
    // collapses onto `06-balance-zero-empty-banner`.
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
  });

  test('pwa-ios-mode', async ({ page }) => {
    await expect(page.getByTestId('pwa-prompt-ios')).toBeVisible({ timeout: 5_000 });
    await snap(page, '10-pwa-ios-mode', { fullPage: true });
  });
});

test.describe('PwaPrompt — manual fallback', () => {
  test.beforeEach(async ({ page }) => {
    await setViewport(page, 'mobile');
    await page.addInitScript({ content: CLEAR_DISMISSED_FLAG });
    await aliceLogin(page);
    // Wait for Alice's balance-poll tick so the wallet behind the
    // PwaPrompt card is funded. Without this the PwaPrompt baselines
    // capture the pre-tick empty-banner state and `pwa-manual-mode`
    // collapses onto `06-balance-zero-empty-banner`.
    await expect(page.getByTestId('wallet-empty-banner')).not.toBeVisible({ timeout: 30_000 });
  });

  test('pwa-manual-mode', async ({ page }) => {
    // Default Chromium UA + no BIP dispatch → desktop manual branch
    // ("Click the install icon in your browser's address bar …").
    await expect(page.getByTestId('pwa-prompt-manual')).toBeVisible({ timeout: 5_000 });
    await snap(page, '10-pwa-manual-mode', { fullPage: true });
  });
});
