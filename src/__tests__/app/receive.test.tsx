/**
 * ReceivePage — honest unavailability until name resolution is wired.
 *
 * Product contract (src/lib/api/client.ts::resolveUsername → 501):
 * even a stored `username` is not a Send-accepted receive path without
 * live NIP-05 resolution. Raw zk1 is rejected by extractRecipient.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import ReceivePage from '@/app/receive/page';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { extractRecipient } from '@/lib/qr';
import { api } from '@/lib/api/client';

const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  usePathname: () => '/receive',
}));

const ALICE = {
  username: 'alice',
  address: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};
const DOMAIN = 'zkcoins.app';

beforeEach(() => {
  routerReplace.mockClear();
  useNetworkStore.setState({
    network: 'regtest',
    usernameDomain: DOMAIN,
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
  });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ReceivePage — send acceptance contract', () => {
  it('stays unavailable even when a local username is stored (resolveUsername is 501)', async () => {
    render(<ReceivePage />);
    expect(screen.getByTestId('receive-heading')).toHaveTextContent('Receive');
    expect(screen.getByTestId('receive-not-available')).toBeInTheDocument();
    expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receive-copy-btn')).not.toBeInTheDocument();

    // Product send path: name resolution is not a /v1 route.
    await expect(api.resolveUsername(ALICE.username!)).rejects.toMatchObject({ status: 501 });
  });

  it('without a name marks receive as not available (no zk1 payload)', () => {
    useWalletStore.setState({
      account: { ...ALICE, username: undefined },
    });
    render(<ReceivePage />);
    expect(screen.getByTestId('receive-not-available')).toBeInTheDocument();
    expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument();
    // Raw address is not a Send-accepted recipient.
    expect(extractRecipient(ALICE.address)).toBeNull();
  });

  it('the back link routes to /', () => {
    render(<ReceivePage />);
    expect(screen.getByTestId('receive-back-link')).toHaveAttribute('href', '/');
  });

  it('shows redirecting placeholder and replaces home when no account', async () => {
    vi.useFakeTimers();
    useWalletStore.setState({ account: null, hasStoredWallet: false });
    render(<ReceivePage />);
    expect(screen.getByTestId('redirecting-placeholder')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(routerReplace).toHaveBeenCalledWith('/');
  });

  it('clears the redirect timer on unmount before it fires', async () => {
    vi.useFakeTimers();
    useWalletStore.setState({ account: null, hasStoredWallet: false });
    const { unmount } = render(<ReceivePage />);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(routerReplace).not.toHaveBeenCalled();
  });
});
