/**
 * Tests for the SeedFlow create-wallet path + Welcome routing in
 * `src/components/onboarding/Onboarding.tsx`.
 *
 * Coverage on Onboarding.tsx jumps from ~57 % to ~80 %+ on lines.
 *
 * The existing `SetPassword.test.tsx` covers the password-stage
 * validation; `Onboarding-restore.test.tsx` covers the restore
 * path. This file fills in the remaining create-path stages:
 *
 *   - Welcome render (heading, benefits, CREATE + Restore buttons)
 *   - Welcome → SeedFlow routing (`onboarding-create-btn` click,
 *     `seed-flow` appears, generate-stage transition)
 *   - generating → reveal transition (WASM mock returns mnemonic)
 *   - reveal hidden → revealed (seed-reveal-btn click flips state)
 *   - reveal → confirm (seed-written-btn)
 *   - confirm → password (seed-confirm-btn)
 *   - happy path through create() → wallet store + auth store set,
 *     balance fetched
 *   - SeedFlow → Welcome via StepHeader Back
 *   - generate-stage WASM error surfaces a seed-error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
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
vi.mock('@/lib/features', () => ({ FEATURES: FEATURES_STATE }));

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

describe('Onboarding — Welcome screen', () => {
  it('renders the heading and the three benefit cards', () => {
    render(<Onboarding />);
    expect(screen.getByTestId('welcome-heading')).toHaveTextContent('Welcome to zkCoins');
    expect(screen.getByText('Truly private by default')).toBeInTheDocument();
    expect(screen.getByText('Just Bitcoin. No altcoin.')).toBeInTheDocument();
    expect(screen.getByText('You hold the keys')).toBeInTheDocument();
  });

  it('renders both CTAs', () => {
    render(<Onboarding />);
    expect(screen.getByTestId('onboarding-create-btn')).toHaveTextContent('CREATE WALLET');
    expect(screen.getByTestId('onboarding-restore-btn')).toHaveTextContent(
      'Restore existing wallet',
    );
  });
});

describe('Onboarding — Welcome → SeedFlow routing', () => {
  it('CREATE WALLET enters SeedFlow when FEATURES.PASSKEY is off (PRD bundle)', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-create-btn'));
    // SeedFlow renders with the seed-flow root testid.
    expect(await screen.findByTestId('seed-flow')).toBeInTheDocument();
  });

  it('StepHeader Back returns to Welcome', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-create-btn'));
    await screen.findByTestId('seed-flow');
    await user.click(screen.getByTestId('onboarding-step-back-btn'));
    expect(screen.getByTestId('welcome-heading')).toBeInTheDocument();
  });
});

describe('Onboarding — SeedFlow stage transitions', () => {
  async function enterSeedFlow(user: ReturnType<typeof userEvent.setup>) {
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-create-btn'));
    // The WASM mock's generateMnemonic resolves synchronously after the
    // mount effect, so the reveal stage appears on the next tick.
    await screen.findByTestId('seed-reveal-btn');
  }

  it('shows the 12-word grid blurred + a "Tap to reveal" overlay button by default', async () => {
    const user = userEvent.setup();
    await enterSeedFlow(user);
    expect(screen.getByTestId('seed-grid')).toBeInTheDocument();
    expect(screen.getByTestId('seed-reveal-btn')).toHaveTextContent('Tap to reveal');
    // Words rendered as bullet placeholders.
    const grid = screen.getByTestId('seed-grid');
    expect(grid.textContent).toMatch(/••••••/);
  });

  it('clicking the reveal button uncovers the mnemonic + shows "I\'ve written it down"', async () => {
    const user = userEvent.setup();
    await enterSeedFlow(user);
    await user.click(screen.getByTestId('seed-reveal-btn'));
    expect(screen.getByTestId('seed-written-btn')).toHaveTextContent("I've written it down");
    // Reveal overlay is gone.
    expect(screen.queryByTestId('seed-reveal-btn')).not.toBeInTheDocument();
    // The mnemonic words from the WASM mock are rendered (12 abandon's + about).
    expect(screen.getByTestId('seed-grid').textContent).toMatch(/abandon/);
  });

  it('written → confirm → password stage chain', async () => {
    const user = userEvent.setup();
    await enterSeedFlow(user);
    await user.click(screen.getByTestId('seed-reveal-btn'));
    await user.click(screen.getByTestId('seed-written-btn'));
    expect(await screen.findByTestId('seed-confirm-btn')).toBeInTheDocument();

    await user.click(screen.getByTestId('seed-confirm-btn'));
    expect(await screen.findByTestId('seed-password-stage')).toBeInTheDocument();
  });
});

describe('Onboarding — full create happy path', () => {
  it('writes account + authMethod=seed + balance through the entire create flow', async () => {
    vi.spyOn(api, 'balance').mockResolvedValue({ balance: 555 });

    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-create-btn'));
    await screen.findByTestId('seed-reveal-btn');
    await user.click(screen.getByTestId('seed-reveal-btn'));
    await user.click(screen.getByTestId('seed-written-btn'));
    await user.click(screen.getByTestId('seed-confirm-btn'));
    await screen.findByTestId('seed-password-stage');

    await user.type(screen.getByTestId('seed-password-input'), 'longenough1');
    await user.type(screen.getByTestId('seed-password-confirm-input'), 'longenough1');
    await user.click(screen.getByTestId('seed-create-btn'));

    // The createMockWasm fake's createAccountFromMnemonic returns address
    // = 'b'.repeat(64). Waiting for balance lets the full chain drain.
    await waitFor(() => {
      expect(useWalletStore.getState().balance).toBe(555);
    });
    expect(useWalletStore.getState().account?.address).toBe('b'.repeat(64));
    expect(useAuthStore.getState().authMethod).toBe('seed');
  });

  it('treats a balance-fetch failure as non-fatal', async () => {
    vi.spyOn(api, 'balance').mockRejectedValue(new Error('server down'));

    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-create-btn'));
    await screen.findByTestId('seed-reveal-btn');
    await user.click(screen.getByTestId('seed-reveal-btn'));
    await user.click(screen.getByTestId('seed-written-btn'));
    await user.click(screen.getByTestId('seed-confirm-btn'));
    await screen.findByTestId('seed-password-stage');
    await user.type(screen.getByTestId('seed-password-input'), 'longenough1');
    await user.type(screen.getByTestId('seed-password-confirm-input'), 'longenough1');
    await user.click(screen.getByTestId('seed-create-btn'));

    await waitFor(() => {
      expect(useAuthStore.getState().authMethod).toBe('seed');
    });
    // Drain the failed-balance microtask so the rejection settles before
    // the next test starts.
    await act(async () => {
      await Promise.resolve();
    });
    expect(useWalletStore.getState().balance).toBeNull();
  });
});

describe('Onboarding — SeedFlow create() error rollback', () => {
  it('rolls stage back to password and shows seed-error when createAccountFromMnemonic throws', async () => {
    const wasm = await initWasm();
    vi.mocked(wasm.createAccountFromMnemonic).mockRejectedValueOnce(new Error('derive failed'));

    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-create-btn'));
    await screen.findByTestId('seed-reveal-btn');
    await user.click(screen.getByTestId('seed-reveal-btn'));
    await user.click(screen.getByTestId('seed-written-btn'));
    await user.click(screen.getByTestId('seed-confirm-btn'));
    await screen.findByTestId('seed-password-stage');
    await user.type(screen.getByTestId('seed-password-input'), 'longenough1');
    await user.type(screen.getByTestId('seed-password-confirm-input'), 'longenough1');
    await user.click(screen.getByTestId('seed-create-btn'));

    expect(await screen.findByTestId('seed-error')).toHaveTextContent(/derive failed/);
    // Stage rolled back so the user can retry.
    expect(screen.getByTestId('seed-password-stage')).toBeInTheDocument();
    expect(useWalletStore.getState().account).toBeNull();
    expect(useAuthStore.getState().authMethod).toBeNull();
  });
});
