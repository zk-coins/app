/**
 * SettingsPage — About section, disconnect chain, redirect when no account.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
import SettingsPage from '@/app/settings/page';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { useNetworkStore } from '@/stores/network';
import { deleteCredential } from '@/lib/crypto/storage';
import { APP_VERSION } from '@/lib/format';

const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  usePathname: () => '/settings',
}));

const FEATURES_STATE = vi.hoisted(() => ({
  APPS_DIRECTORY: false,
  PASSKEY: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
}));
vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

vi.mock('@/lib/crypto/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crypto/storage')>();
  return { ...actual, deleteCredential: vi.fn().mockResolvedValue(undefined) };
});

const ALICE = {
  address: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};

const originalDeleteWallet = useWalletStore.getState().deleteWallet;
const originalReset = useAuthStore.getState().reset;

beforeEach(() => {
  routerReplace.mockClear();
  Object.assign(FEATURES_STATE, {
    ADDRESS_ROTATION: false,
    TOR_ROUTING: false,
  });
  useNetworkStore.setState({
    network: 'regtest',
    apiUrl: 'https://api.example.test',
    infoError: null,
    infoLoaded: true,
  });
  useWalletStore.setState({
    account: ALICE,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: true,
    storedAddress: ALICE.address,
    storedAuthMethod: 'seed',
    error: null,
    needsSeedReimport: false,
    deleteWallet: originalDeleteWallet,
  });
  useAuthStore.setState({
    authMethod: 'seed',
    credentialId: null,
    isHydrated: true,
    reset: originalReset,
  });
  vi.mocked(deleteCredential).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SettingsPage', () => {
  it('renders heading, version, network, and node host', () => {
    render(<SettingsPage />);
    expect(screen.getByTestId('settings-heading')).toHaveTextContent('Settings');
    expect(screen.getByText(`v${APP_VERSION}`)).toBeInTheDocument();
    expect(screen.getByText('regtest')).toBeInTheDocument();
    expect(screen.getByTestId('settings-node-host')).toHaveTextContent('api.example.test');
    expect(screen.getByTestId('settings-section-about')).toBeInTheDocument();
  });

  it('hides network row when network tag is empty', () => {
    useNetworkStore.setState({ network: '' });
    render(<SettingsPage />);
    expect(screen.queryByText('Network')).not.toBeInTheDocument();
  });

  it('disconnect confirms, wipes wallet + credential + auth', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const deleteWallet = vi.fn().mockResolvedValue(undefined);
    useWalletStore.setState({ deleteWallet } as never);
    const resetAuth = vi.fn();
    useAuthStore.setState({ reset: resetAuth } as never);

    vi.mocked(deleteCredential).mockImplementation(async () => {
      expect(deleteWallet).not.toHaveBeenCalled();
      expect(resetAuth).not.toHaveBeenCalled();
    });
    resetAuth.mockImplementation(() => {
      expect(deleteCredential).toHaveBeenCalled();
      expect(deleteWallet).not.toHaveBeenCalled();
    });

    render(<SettingsPage />);
    await user.click(screen.getByTestId('settings-disconnect-btn'));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleteWallet).toHaveBeenCalled());
    expect(deleteCredential).toHaveBeenCalled();
    expect(resetAuth).toHaveBeenCalled();
    expect(vi.mocked(deleteCredential).mock.invocationCallOrder[0]).toBeLessThan(
      resetAuth.mock.invocationCallOrder[0],
    );
    expect(resetAuth.mock.invocationCallOrder[0]).toBeLessThan(
      deleteWallet.mock.invocationCallOrder[0],
    );
  });

  it('disconnect aborts when the user cancels the confirm dialog', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    const deleteWallet = vi.fn();
    useWalletStore.setState({ deleteWallet } as never);

    render(<SettingsPage />);
    await user.click(screen.getByTestId('settings-disconnect-btn'));
    expect(deleteWallet).not.toHaveBeenCalled();
    expect(deleteCredential).not.toHaveBeenCalled();
  });

  it('redirects home when there is no account after the grace timeout', async () => {
    vi.useFakeTimers();
    useWalletStore.setState({ account: null, hasStoredWallet: false });
    render(<SettingsPage />);
    expect(screen.queryByTestId('settings-disconnect-btn')).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(routerReplace).toHaveBeenCalledWith('/');
  });

  it('does not redirect when the store reports an account when the grace callback fires', async () => {
    vi.useFakeTimers();
    useWalletStore.setState({ account: null, hasStoredWallet: false });
    render(<SettingsPage />);
    const stateWithAccount = { ...useWalletStore.getState(), account: ALICE };
    const getStateSpy = vi.spyOn(useWalletStore, 'getState').mockReturnValue(stateWithAccount);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(routerReplace).not.toHaveBeenCalled();
    getStateSpy.mockRestore();
  });

  it('clears the redirect timeout on unmount', async () => {
    vi.useFakeTimers();
    useWalletStore.setState({ account: null, hasStoredWallet: false });
    const { unmount } = render(<SettingsPage />);
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('shows Privacy toggles when ADDRESS_ROTATION / TOR_ROUTING are on', () => {
    Object.assign(FEATURES_STATE, { ADDRESS_ROTATION: true, TOR_ROUTING: true });
    render(<SettingsPage />);
    expect(screen.getByTestId('settings-section-privacy')).toBeInTheDocument();
    expect(screen.getByText('Auto-rotate receive address')).toBeInTheDocument();
    expect(screen.getByText('Tor routing')).toBeInTheDocument();
    // Planned toggles ship disabled
    const buttons = screen.getAllByRole('button', { pressed: false });
    expect(buttons.some((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it.each([
    [true, false, 'Auto-rotate receive address'],
    [false, true, 'Tor routing'],
  ])('renders each privacy capability independently', (rotation, tor, visible) => {
    Object.assign(FEATURES_STATE, { ADDRESS_ROTATION: rotation, TOR_ROUTING: tor });
    render(<SettingsPage />);
    expect(screen.getByText(visible)).toBeInTheDocument();
  });
});
