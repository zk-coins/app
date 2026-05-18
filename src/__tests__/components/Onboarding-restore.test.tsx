/**
 * Tests for the SeedImportFlow restore path in
 * `src/components/onboarding/Onboarding.tsx`.
 *
 * Onboarding.tsx is 847 LOC and the only existing unit test
 * (`SetPassword.test.tsx`) covers the create-wallet password stage.
 * The restore path has its own BIP-39 validation, word-count guard,
 * and store-write semantics that fan out to:
 *   - `wasm.validateMnemonic(...)` (BIP-39 list check)
 *   - `wasm.createAccountFromMnemonic(...)` (derives address + xpriv)
 *   - `useWalletStore.saveWithPassword(...)` (AES-256-GCM persist)
 *   - `useAuthStore.setAuth('seed')`
 * If any of those calls is wired wrongly or a stage transition
 * regresses, only e2e/03-restore-seed.spec.ts would catch it — and
 * it asserts the resulting wallet shape, not the precise stage
 * transitions or error-clearing behaviour.
 *
 * The setup-file WASM mock (`createMockWasm`) returns a deterministic
 * `validateMnemonic === true` by default; tests that exercise the
 * invalid-mnemonic branch flip that locally.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { initWasm } from '@zkcoins/wasm';
import { api } from '@/lib/api/client';

const FEATURES_STATE = vi.hoisted(() => ({
  USERNAMES: false,
  APPS_DIRECTORY: false,
  PASSKEY: false,
  FAUCET: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
}));
vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

const VALID_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

beforeEach(() => {
  Object.assign(FEATURES_STATE, {
    USERNAMES: false,
    APPS_DIRECTORY: false,
    PASSKEY: false,
    FAUCET: false,
    DEV_ROUTES: false,
    AUTO_LOCK: false,
    ADDRESS_ROTATION: false,
    TOR_ROUTING: false,
  });
  useWalletStore.setState({
    account: null,
    balance: null,
    transactions: [],
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    error: null,
  });
  useAuthStore.setState({ authMethod: null, credentialId: null });
  localStorage.clear();
});

async function reachImportStage(user: ReturnType<typeof userEvent.setup>) {
  render(<Onboarding />);
  await user.click(await screen.findByTestId('onboarding-restore-btn'));
  await screen.findByTestId('seed-import-textarea');
}

describe('SeedImportFlow — entry from Welcome', () => {
  it('opens the import flow when the Restore button is clicked', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(await screen.findByTestId('onboarding-restore-btn'));
    expect(await screen.findByTestId('seed-import-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('seed-import-continue-btn')).toBeDisabled();
  });

  it('returns to Welcome when the Back button is clicked', async () => {
    const user = userEvent.setup();
    await reachImportStage(user);
    await user.click(screen.getByTestId('onboarding-step-back-btn'));
    expect(await screen.findByTestId('welcome-heading')).toBeInTheDocument();
  });
});

describe('SeedImportFlow — input validation', () => {
  it('enables Continue once any non-empty text is typed', async () => {
    const user = userEvent.setup();
    await reachImportStage(user);
    const continueBtn = screen.getByTestId('seed-import-continue-btn');
    expect(continueBtn).toBeDisabled();
    await user.type(screen.getByTestId('seed-import-textarea'), 'abandon');
    expect(continueBtn).toBeEnabled();
  });

  it('rejects a phrase that is not exactly 12 words', async () => {
    const user = userEvent.setup();
    await reachImportStage(user);
    await user.type(screen.getByTestId('seed-import-textarea'), 'abandon abandon abandon');
    await user.click(screen.getByTestId('seed-import-continue-btn'));
    expect(await screen.findByTestId('seed-import-error')).toHaveTextContent(
      'Enter exactly 12 words',
    );
    // Stage stays on input — password stage is not reached.
    expect(screen.queryByTestId('seed-import-password-stage')).not.toBeInTheDocument();
  });

  it('rejects a 12-word phrase that fails the BIP-39 list check', async () => {
    // Flip the WASM mock's validateMnemonic to return false for this test.
    const wasm = await initWasm();
    vi.mocked(wasm.validateMnemonic).mockReturnValueOnce(false);

    const user = userEvent.setup();
    await reachImportStage(user);
    // 12 words but presumed not all in the wordlist.
    await user.type(
      screen.getByTestId('seed-import-textarea'),
      'foo bar baz qux quux corge grault garply waldo fred plugh xyzzy',
    );
    await user.click(screen.getByTestId('seed-import-continue-btn'));
    expect(await screen.findByTestId('seed-import-error')).toHaveTextContent(/Invalid seed phrase/);
    expect(screen.queryByTestId('seed-import-password-stage')).not.toBeInTheDocument();
  });

  it('accepts a valid 12-word phrase and advances to the password stage', async () => {
    const user = userEvent.setup();
    await reachImportStage(user);
    await user.type(screen.getByTestId('seed-import-textarea'), VALID_PHRASE);
    await user.click(screen.getByTestId('seed-import-continue-btn'));
    expect(await screen.findByTestId('seed-import-password-stage')).toBeInTheDocument();
  });

  it('clears the inline error as soon as the user retypes', async () => {
    const user = userEvent.setup();
    await reachImportStage(user);
    const textarea = screen.getByTestId('seed-import-textarea');
    await user.type(textarea, 'too few');
    await user.click(screen.getByTestId('seed-import-continue-btn'));
    expect(await screen.findByTestId('seed-import-error')).toBeInTheDocument();
    // Type another character — the onChange clears the error eagerly,
    // even before the user re-submits.
    await user.type(textarea, 'x');
    expect(screen.queryByTestId('seed-import-error')).not.toBeInTheDocument();
  });
});

describe('SeedImportFlow — password stage validation', () => {
  async function reachPasswordStage(user: ReturnType<typeof userEvent.setup>) {
    await reachImportStage(user);
    await user.type(screen.getByTestId('seed-import-textarea'), VALID_PHRASE);
    await user.click(screen.getByTestId('seed-import-continue-btn'));
    await screen.findByTestId('seed-import-password-stage');
  }

  it('disables Restore wallet while either password field is empty', async () => {
    const user = userEvent.setup();
    await reachPasswordStage(user);
    const submit = screen.getByTestId('seed-import-submit-btn');
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId('seed-import-password-input'), 'longenough');
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId('seed-import-password-confirm-input'), 'longenough');
    expect(submit).toBeEnabled();
  });

  it('rejects a password shorter than 8 characters', async () => {
    const user = userEvent.setup();
    await reachPasswordStage(user);
    await user.type(screen.getByTestId('seed-import-password-input'), 'short');
    await user.type(screen.getByTestId('seed-import-password-confirm-input'), 'short');
    await user.click(screen.getByTestId('seed-import-submit-btn'));
    expect(await screen.findByTestId('seed-import-error')).toHaveTextContent(
      /Password must be at least 8 characters/,
    );
  });

  it('rejects mismatched passwords', async () => {
    const user = userEvent.setup();
    await reachPasswordStage(user);
    await user.type(screen.getByTestId('seed-import-password-input'), 'longenough1');
    await user.type(screen.getByTestId('seed-import-password-confirm-input'), 'different!2');
    await user.click(screen.getByTestId('seed-import-submit-btn'));
    expect(await screen.findByTestId('seed-import-error')).toHaveTextContent(
      /Passwords do not match/,
    );
  });
});

describe('SeedImportFlow — restore side effects', () => {
  it('writes the account to the wallet store and sets authMethod=seed on success', async () => {
    vi.spyOn(api, 'balance').mockResolvedValue({ balance: 42 });

    const user = userEvent.setup();
    await reachImportStage(user);
    await user.type(screen.getByTestId('seed-import-textarea'), VALID_PHRASE);
    await user.click(screen.getByTestId('seed-import-continue-btn'));
    await screen.findByTestId('seed-import-password-stage');
    await user.type(screen.getByTestId('seed-import-password-input'), 'longenough');
    await user.type(screen.getByTestId('seed-import-password-confirm-input'), 'longenough');
    await user.click(screen.getByTestId('seed-import-submit-btn'));

    // Wait for the *final* side effect (balance fetch) to land — that
    // implies the prior writes (setAccount, saveWithPassword, setAuth)
    // have all settled. Asserting on `account` alone is not enough
    // because saveWithPassword + setAuth + balance fetch are still
    // pending when `account` first becomes non-null, and those
    // leftover promises bleed into the next test if we don't wait.
    await waitFor(() => {
      expect(useWalletStore.getState().balance).toBe(42);
    });
    expect(useWalletStore.getState().account?.address).toBe('b'.repeat(64));
    expect(useAuthStore.getState().authMethod).toBe('seed');
  });

  it('treats a balance-fetch failure as non-fatal and leaves balance null', async () => {
    vi.spyOn(api, 'balance').mockRejectedValue(new Error('server down'));

    const user = userEvent.setup();
    await reachImportStage(user);
    await user.type(screen.getByTestId('seed-import-textarea'), VALID_PHRASE);
    await user.click(screen.getByTestId('seed-import-continue-btn'));
    await screen.findByTestId('seed-import-password-stage');
    await user.type(screen.getByTestId('seed-import-password-input'), 'longenough');
    await user.type(screen.getByTestId('seed-import-password-confirm-input'), 'longenough');
    await user.click(screen.getByTestId('seed-import-submit-btn'));

    // authMethod is set immediately before the balance fetch fires; once
    // we observe it, the catch-and-swallow path that follows has also
    // completed (the awaited rejection runs to its `catch {}` block before
    // restore() returns). Add an explicit microtask flush so the rejected
    // promise's catch runs before the next test starts.
    await waitFor(() => {
      expect(useAuthStore.getState().authMethod).toBe('seed');
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(useWalletStore.getState().balance).toBeNull();
  });

  it('reverts to the password stage and surfaces the error when createAccountFromMnemonic throws', async () => {
    const wasm = await initWasm();
    vi.mocked(wasm.createAccountFromMnemonic).mockRejectedValueOnce(new Error('derive failed'));

    const user = userEvent.setup();
    await reachImportStage(user);
    await user.type(screen.getByTestId('seed-import-textarea'), VALID_PHRASE);
    await user.click(screen.getByTestId('seed-import-continue-btn'));
    await screen.findByTestId('seed-import-password-stage');
    await user.type(screen.getByTestId('seed-import-password-input'), 'longenough');
    await user.type(screen.getByTestId('seed-import-password-confirm-input'), 'longenough');
    await user.click(screen.getByTestId('seed-import-submit-btn'));

    expect(await screen.findByTestId('seed-import-error')).toHaveTextContent(/derive failed/);
    // Stage rolled back from restoring → password so the user can retry.
    expect(screen.getByTestId('seed-import-password-stage')).toBeInTheDocument();
    // Nothing was written to the wallet store by *this* render — the
    // catch block aborts before setAccount/setAuth/saveWithPassword.
    expect(useWalletStore.getState().account).toBeNull();
    expect(useAuthStore.getState().authMethod).toBeNull();
  });
});
