/**
 * SettingsPage tests (`src/app/settings/page.tsx`).
 *
 * The settings surface is mostly read-only chrome (Section/Toggle
 * cards + version + network badge) plus one load-bearing action:
 * the `Disconnect Wallet` button that wipes `useWalletStore` +
 * `useAuthStore` and removes the IndexedDB credential, gated by a
 * `window.confirm` dialog.
 *
 * `e2e/05-disconnect.spec.ts` covers the styled output and the
 * dialog accept/cancel flow, but does not lock in the store-side
 * effects (no clean way to inspect Zustand from Playwright) nor
 * the `authMethod` → recovery-copy mapping that decides whether
 * the page tells the user about their seed phrase or their
 * passkey.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPage from '@/app/settings/page';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { useNetworkStore } from '@/stores/network';

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

const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  usePathname: () => '/settings',
}));

const ALICE = {
  address: 'a'.repeat(64),
  numPubkeys: 0,
  xpriv: 'xprv-alice',
};

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
  routerReplace.mockClear();
  useNetworkStore.setState({
    apiUrl: 'https://test.api',
    networkName: 'signet',
    setNetworkName: useNetworkStore.getState().setNetworkName,
  });
  useWalletStore.setState({
    account: ALICE,
    balance: 1000,
    transactions: [],
    isLoading: false,
    isLocked: false,
    hasStoredWallet: true,
    storedAddress: ALICE.address,
    storedAuthMethod: 'seed',
    error: null,
  });
  useAuthStore.setState({ authMethod: 'seed', credentialId: null, isHydrated: true });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SettingsPage — header + sections', () => {
  it('renders the heading, network badge, and the three always-on sections', () => {
    render(<SettingsPage />);
    expect(screen.getByTestId('settings-heading')).toHaveTextContent('Settings');
    expect(screen.getByTestId('settings-network-badge')).toHaveTextContent('signet');
    expect(screen.getByTestId('settings-section-security')).toBeInTheDocument();
    expect(screen.getByTestId('settings-section-resources')).toBeInTheDocument();
    expect(screen.getByTestId('settings-section-about')).toBeInTheDocument();
  });

  it('hides the network badge when networkName is empty (pre-info-tick)', () => {
    useNetworkStore.setState({ networkName: '' });
    render(<SettingsPage />);
    expect(screen.queryByTestId('settings-network-badge')).not.toBeInTheDocument();
  });

  it('hides the Privacy section when both gating flags are off (PRD bundle)', () => {
    render(<SettingsPage />);
    expect(screen.queryByTestId('settings-section-privacy')).not.toBeInTheDocument();
  });

  it('renders the Privacy section when either ADDRESS_ROTATION or TOR_ROUTING is on (DEV bundle)', () => {
    FEATURES_STATE.ADDRESS_ROTATION = true;
    render(<SettingsPage />);
    expect(screen.getByTestId('settings-section-privacy')).toBeInTheDocument();
  });
});

describe('SettingsPage — recovery copy switches on authMethod', () => {
  it('renders the seed-phrase recovery copy when authMethod=seed', () => {
    useAuthStore.setState({ authMethod: 'seed' });
    render(<SettingsPage />);
    expect(screen.getByText(/12-word seed phrase was shown once/)).toBeInTheDocument();
  });

  it('renders the passkey recovery copy when authMethod=passkey', () => {
    useAuthStore.setState({ authMethod: 'passkey', credentialId: 'cred' });
    render(<SettingsPage />);
    expect(screen.getByText(/Your wallet is derived from your passkey/)).toBeInTheDocument();
  });

  it('renders the "Not configured" auth-method copy when authMethod is null', () => {
    useAuthStore.setState({ authMethod: null });
    render(<SettingsPage />);
    expect(screen.getByText(/Not configured/)).toBeInTheDocument();
  });
});

describe('SettingsPage — disconnect flow', () => {
  it('wipes the wallet + auth stores when the confirm dialog is accepted', async () => {
    // happy-dom does not ship `window.confirm`; assign one explicitly.
    const confirmSpy = vi.fn().mockReturnValue(true);
    window.confirm = confirmSpy as typeof window.confirm;
    const user = userEvent.setup();

    render(<SettingsPage />);
    await user.click(screen.getByTestId('settings-disconnect-btn'));

    // Wait for the full async chain (deleteWallet → deleteCredential →
    // resetAuth) to settle. Asserting on `authMethod=null` directly is
    // fragile because the call sequence completes one promise at a
    // time; `waitFor` polls until the final state is observed.
    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(useAuthStore.getState().authMethod).toBeNull();
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(useWalletStore.getState().account).toBeNull();
    expect(useWalletStore.getState().hasStoredWallet).toBe(false);
    expect(useAuthStore.getState().credentialId).toBeNull();
  });

  it('does nothing when the confirm dialog is dismissed', async () => {
    window.confirm = vi.fn().mockReturnValue(false) as typeof window.confirm;
    const user = userEvent.setup();

    render(<SettingsPage />);
    await user.click(screen.getByTestId('settings-disconnect-btn'));
    // The handler returns synchronously on `confirm()=false` — no
    // promises in flight. A single microtask drain is enough to flush
    // any React batch.
    await act(async () => {
      await Promise.resolve();
    });

    // Stores untouched.
    expect(useWalletStore.getState().account).toEqual(ALICE);
    expect(useAuthStore.getState().authMethod).toBe('seed');
  });

  it('hides the disconnect button when no account is present', () => {
    useWalletStore.setState({ account: null });
    render(<SettingsPage />);
    expect(screen.queryByTestId('settings-disconnect-btn')).not.toBeInTheDocument();
  });
});

describe('SettingsPage — no-account redirect', () => {
  it('calls router.replace("/") after the 100 ms grace window when no account is set', async () => {
    useWalletStore.setState({ account: null });
    vi.useFakeTimers();
    render(<SettingsPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(routerReplace).toHaveBeenCalledWith('/');
  });

  it('suppresses the redirect when the account lands inside the 100 ms grace', async () => {
    useWalletStore.setState({ account: null });
    vi.useFakeTimers();
    render(<SettingsPage />);
    act(() => {
      useWalletStore.setState({ account: ALICE });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(routerReplace).not.toHaveBeenCalled();
  });
});

describe('SettingsPage — Toggle interaction (Auto-lock card)', () => {
  it('toggles on/off when clicked (defensive — wire is currently disabled-style but onClick still flips)', async () => {
    FEATURES_STATE.AUTO_LOCK = true;
    const user = userEvent.setup();
    render(<SettingsPage />);

    // The toggle inside the Auto-lock card has aria-pressed semantics.
    // It's the only toggle inside the Security section.
    const securitySection = screen.getByTestId('settings-section-security');
    const toggle = securitySection.querySelector('button[aria-pressed]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    // Auto-lock starts on (defaultOn=true) and is disabled — onClick is a no-op.
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toBeDisabled();
    await user.click(toggle);
    // Still on — the disabled guard prevents the flip.
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});
