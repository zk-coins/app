/**
 * SettingsPage tests (`src/app/settings/page.tsx`).
 *
 * The settings surface is read-only chrome (the About card listing
 * version, network, and the connected node host) plus one load-bearing
 * action: the `Disconnect Wallet` button that
 * wipes `useWalletStore` + `useAuthStore` and removes the IndexedDB
 * credential, gated by a `window.confirm` dialog.
 *
 * `e2e/05-disconnect.spec.ts` covers the styled output and the
 * dialog accept/cancel flow, but does not lock in the store-side
 * effects (no clean way to inspect Zustand from Playwright).
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
  it('renders the heading, the About section, and the node host', () => {
    render(<SettingsPage />);
    expect(screen.getByTestId('settings-heading')).toHaveTextContent('Settings');
    expect(screen.getByTestId('settings-section-about')).toBeInTheDocument();
    expect(screen.getByText('signet')).toBeInTheDocument();
    // Node host is the configured apiUrl with the scheme stripped.
    expect(screen.getByTestId('settings-node-host')).toHaveTextContent('test.api');
  });

  it('hides the Network row when networkName is empty (pre-info-tick) but still shows the node host', () => {
    useNetworkStore.setState({ networkName: '' });
    render(<SettingsPage />);
    expect(screen.queryByText('signet')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-node-host')).toHaveTextContent('test.api');
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

describe('SettingsPage — Privacy toggle interaction', () => {
  it('renders a disabled "Planned" toggle inside the Privacy section', async () => {
    FEATURES_STATE.ADDRESS_ROTATION = true;
    const user = userEvent.setup();
    render(<SettingsPage />);

    const privacySection = screen.getByTestId('settings-section-privacy');
    const toggle = privacySection.querySelector('button[aria-pressed]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    // Planned toggles ship off + disabled — onClick is a no-op.
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toBeDisabled();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});
