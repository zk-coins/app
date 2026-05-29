/**
 * Component test — password-stage validation in `SeedFlow`
 * (`src/components/onboarding/Onboarding.tsx`). Issue #68 W1.
 *
 * Targets the password-mismatch + min-length branches without exercising
 * the full onboarding pipeline. The flow is walked just enough to reach
 * the password stage (data-testid hops) — the *behaviour being asserted*
 * is the password fields, the Create-button disabled state, and the
 * error rendering. The happy-path (creating an account, persisting the
 * encrypted blob) is covered by e2e spec 02.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';

beforeEach(() => {
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

async function reachPasswordStage(user: ReturnType<typeof userEvent.setup>) {
  render(<Onboarding />);
  await user.click(screen.getByTestId('onboarding-create-btn'));
  // The WASM mock resolves `generateMnemonic` synchronously after the
  // initWasm await — the reveal button appears on the next tick.
  const reveal = await screen.findByTestId('seed-reveal-btn');
  await user.click(reveal);
  await user.click(await screen.findByTestId('seed-written-btn'));
  await user.click(await screen.findByTestId('seed-confirm-btn'));
  await screen.findByTestId('seed-password-stage');
}

describe('SeedFlow — password stage validation', () => {
  it('disables Create wallet button while either field is empty', async () => {
    const user = userEvent.setup();
    await reachPasswordStage(user);

    const createBtn = screen.getByTestId('seed-create-btn');
    expect(createBtn).toBeDisabled();

    await user.type(screen.getByTestId('seed-password-input'), 'longenough');
    expect(createBtn).toBeDisabled();

    await user.type(screen.getByTestId('seed-password-confirm-input'), 'longenough');
    expect(createBtn).toBeEnabled();
  });

  it('shows "Passwords do not match" when confirm differs', async () => {
    const user = userEvent.setup();
    await reachPasswordStage(user);

    await user.type(screen.getByTestId('seed-password-input'), 'longenough');
    await user.type(screen.getByTestId('seed-password-confirm-input'), 'different!');
    await user.click(screen.getByTestId('seed-create-btn'));

    expect(await screen.findByTestId('seed-error')).toHaveTextContent('Passwords do not match');
  });

  it('shows "at least 8 characters" when both fields are too short', async () => {
    const user = userEvent.setup();
    await reachPasswordStage(user);

    await user.type(screen.getByTestId('seed-password-input'), 'short');
    await user.type(screen.getByTestId('seed-password-confirm-input'), 'short');
    await user.click(screen.getByTestId('seed-create-btn'));

    expect(await screen.findByTestId('seed-error')).toHaveTextContent(
      'Password must be at least 8 characters',
    );
  });

  it('clears the inline error once a valid pair is accepted', async () => {
    const user = userEvent.setup();
    await reachPasswordStage(user);

    // First: trigger the mismatch error.
    await user.type(screen.getByTestId('seed-password-input'), 'longenough');
    await user.type(screen.getByTestId('seed-password-confirm-input'), 'mismatched');
    await user.click(screen.getByTestId('seed-create-btn'));
    expect(await screen.findByTestId('seed-error')).toBeInTheDocument();

    // Fix confirm to match, click again — error clears before the
    // stage transitions to 'creating' (which the WASM mock makes
    // succeed instantly).
    await user.clear(screen.getByTestId('seed-password-confirm-input'));
    await user.type(screen.getByTestId('seed-password-confirm-input'), 'longenough');
    await user.click(screen.getByTestId('seed-create-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('seed-error')).not.toBeInTheDocument();
    });
  });
});
