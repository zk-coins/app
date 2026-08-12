/**
 * Onboarding seed create + seed import flows (PASSKEY off — default build).
 * Covers the default-active onboarding surface for global coverage floors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';

const FEATURES_STATE = vi.hoisted(() => ({
  PASSKEY: false,
  APPS_DIRECTORY: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
}));
vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

const FIXTURE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

beforeEach(() => {
  Object.assign(FEATURES_STATE, { PASSKEY: false });
  useWalletStore.setState({
    account: null,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    error: null,
    needsSeedReimport: false,
  });
  useAuthStore.setState({ authMethod: null, credentialId: null, isHydrated: true });
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Onboarding — seed create flow', () => {
  it('walks welcome → seed reveal → confirm → password → creates wallet', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);

    expect(screen.getByTestId('welcome-heading')).toBeInTheDocument();
    await user.click(screen.getByTestId('onboarding-create-btn'));

    expect(await screen.findByTestId('seed-flow')).toBeInTheDocument();
    // Wait for mnemonic generation
    expect(await screen.findByTestId('seed-reveal-btn')).toBeInTheDocument();
    await user.click(screen.getByTestId('seed-reveal-btn'));
    await user.click(screen.getByTestId('seed-written-btn'));
    await user.click(screen.getByTestId('seed-confirm-btn'));

    expect(screen.getByTestId('seed-password-stage')).toBeInTheDocument();
    await user.type(screen.getByTestId('seed-password-input'), 'password123');
    await user.type(screen.getByTestId('seed-password-confirm-input'), 'password123');
    await user.click(screen.getByTestId('seed-create-btn'));

    await waitFor(() => {
      expect(useWalletStore.getState().account).not.toBeNull();
    });
    expect(useWalletStore.getState().account?.mnemonic.split(' ')).toHaveLength(12);
    expect(useAuthStore.getState().authMethod).toBe('seed');
  });

  it('rejects short / mismatched passwords on create', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-create-btn'));
    await user.click(await screen.findByTestId('seed-reveal-btn'));
    await user.click(screen.getByTestId('seed-written-btn'));
    await user.click(screen.getByTestId('seed-confirm-btn'));

    await user.type(screen.getByTestId('seed-password-input'), 'short');
    await user.type(screen.getByTestId('seed-password-confirm-input'), 'short');
    await user.click(screen.getByTestId('seed-create-btn'));
    expect(await screen.findByTestId('seed-error')).toHaveTextContent(/at least 8/);

    await user.clear(screen.getByTestId('seed-password-input'));
    await user.clear(screen.getByTestId('seed-password-confirm-input'));
    await user.type(screen.getByTestId('seed-password-input'), 'password123');
    await user.type(screen.getByTestId('seed-password-confirm-input'), 'password999');
    await user.click(screen.getByTestId('seed-create-btn'));
    expect(await screen.findByTestId('seed-error')).toHaveTextContent(/do not match/);
  });

  it('step back returns to welcome', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-create-btn'));
    expect(await screen.findByTestId('seed-flow')).toBeInTheDocument();
    await user.click(screen.getByTestId('onboarding-step-back-btn'));
    expect(screen.getByTestId('welcome-heading')).toBeInTheDocument();
  });
});

describe('Onboarding — seed import / restore flow', () => {
  it('restores from a valid 12-word phrase', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-restore-btn'));

    await user.type(screen.getByTestId('seed-import-textarea'), FIXTURE);
    await user.click(screen.getByTestId('seed-import-continue-btn'));

    expect(await screen.findByTestId('seed-import-password-stage')).toBeInTheDocument();
    await user.type(screen.getByTestId('seed-import-password-input'), 'password123');
    await user.type(screen.getByTestId('seed-import-password-confirm-input'), 'password123');
    await user.click(screen.getByTestId('seed-import-submit-btn'));

    await waitFor(() => {
      expect(useWalletStore.getState().account).not.toBeNull();
    });
    expect(useWalletStore.getState().account?.mnemonic).toBe(FIXTURE);
    expect(useAuthStore.getState().authMethod).toBe('seed');
  });

  it('rejects wrong word count and invalid mnemonics', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-restore-btn'));

    await user.type(screen.getByTestId('seed-import-textarea'), 'one two three');
    await user.click(screen.getByTestId('seed-import-continue-btn'));
    expect(await screen.findByTestId('seed-import-error')).toHaveTextContent(/exactly 12/);

    await user.clear(screen.getByTestId('seed-import-textarea'));
    await user.type(
      screen.getByTestId('seed-import-textarea'),
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon',
    );
    await user.click(screen.getByTestId('seed-import-continue-btn'));
    expect(await screen.findByTestId('seed-import-error')).toHaveTextContent(/Invalid seed/);
  });

  it('rejects short / mismatched passwords on restore', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-restore-btn'));
    await user.type(screen.getByTestId('seed-import-textarea'), FIXTURE);
    await user.click(screen.getByTestId('seed-import-continue-btn'));
    await screen.findByTestId('seed-import-password-stage');

    await user.type(screen.getByTestId('seed-import-password-input'), 'short');
    await user.type(screen.getByTestId('seed-import-password-confirm-input'), 'short');
    await user.click(screen.getByTestId('seed-import-submit-btn'));
    expect(await screen.findByTestId('seed-import-error')).toHaveTextContent(/at least 8/);

    await user.clear(screen.getByTestId('seed-import-password-input'));
    await user.clear(screen.getByTestId('seed-import-password-confirm-input'));
    await user.type(screen.getByTestId('seed-import-password-input'), 'password123');
    await user.type(screen.getByTestId('seed-import-password-confirm-input'), 'password999');
    await user.click(screen.getByTestId('seed-import-submit-btn'));
    expect(await screen.findByTestId('seed-import-error')).toHaveTextContent(/do not match/);
  });
});

describe('Onboarding — reimportRequired', () => {
  it('shows reimport banner and discard invokes onDiscardLegacy', async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    render(<Onboarding reimportRequired onDiscardLegacy={onDiscard} />);
    expect(screen.getByTestId('seed-reimport-required')).toBeInTheDocument();
    // Create is hidden; restore is the primary path
    expect(screen.queryByTestId('onboarding-create-btn')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('onboarding-discard-legacy-btn'));
    expect(onDiscard).toHaveBeenCalled();
  });

  it('reimport restore starts at seed-import from welcome next', async () => {
    const user = userEvent.setup();
    render(<Onboarding reimportRequired />);
    await user.click(screen.getByTestId('onboarding-restore-btn'));
    expect(screen.getByTestId('seed-import-textarea')).toBeInTheDocument();
    expect(screen.queryByTestId('seed-flow')).not.toBeInTheDocument();
    expect(screen.queryByText('Use a passkey')).not.toBeInTheDocument();
  });
});
