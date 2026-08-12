/**
 * Send edge cases under the fail-closed surface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import { render } from '@/__tests__/_helpers/intl';
import SendPage from '@/app/send/page';
import { useWalletStore } from '@/stores/wallet';
import { useCapabilities } from '@/stores/capabilities';

const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const ALICE = {
  address: 'a'.repeat(64),
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};

beforeEach(() => {
  routerReplace.mockClear();
  useCapabilities.setState({
    capabilities: { address_list: false, username_claim: false, lnurl: false, multi_asset: true },
    loaded: true,
  });
  useWalletStore.setState({
    account: ALICE,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: true,
    storedAddress: ALICE.address,
    storedAuthMethod: 'seed',
    error: null,
  });
});

describe('SendPage edge cases — unavailable', () => {
  it('shows redirecting placeholder without account', () => {
    useWalletStore.setState({ account: null });
    render(<SendPage />);
    expect(screen.getByTestId('redirecting-placeholder')).toBeInTheDocument();
  });

  it('never mounts a confirm dialog', () => {
    render(<SendPage />);
    expect(screen.queryByTestId('send-confirm-card')).toBeNull();
  });

  it('redirects after the no-account grace period', async () => {
    vi.useFakeTimers();
    useWalletStore.setState({ account: null });
    render(<SendPage />);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(routerReplace).toHaveBeenCalledWith('/');
    vi.useRealTimers();
  });

  it('does not redirect when the store reports an account when the grace callback fires', async () => {
    vi.useFakeTimers();
    useWalletStore.setState({ account: null });
    render(<SendPage />);
    const stateWithAccount = { ...useWalletStore.getState(), account: ALICE };
    const getStateSpy = vi.spyOn(useWalletStore, 'getState').mockReturnValue(stateWithAccount);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(routerReplace).not.toHaveBeenCalled();
    getStateSpy.mockRestore();
    vi.useRealTimers();
  });

  it('clears the redirect timer on unmount', async () => {
    vi.useFakeTimers();
    useWalletStore.setState({ account: null });
    const { unmount } = render(<SendPage />);
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(routerReplace).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
