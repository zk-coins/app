/**
 * Send page is fail-closed until input-coin selection ships.
 * These tests assert the honest "not available yet" surface — no form
 * that could POST /v1/tx with empty input_coins.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import { render } from '@/__tests__/_helpers/intl';
import SendPage from '@/app/send/page';
import { useWalletStore } from '@/stores/wallet';
import { useCapabilities } from '@/stores/capabilities';
import { api } from '@/lib/api/client';

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
  sessionStorage.clear();
  routerReplace.mockClear();
  useCapabilities.setState({
    capabilities: { address_list: false, username_claim: false, lnurl: false, multi_asset: false },
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

afterEach(() => {
  vi.useRealTimers();
});

describe('SendPage — not available yet', () => {
  it('renders the honest unavailable banner and disables submit', () => {
    const sendSpy = vi.spyOn(api, 'send');
    const walletSendSpy = vi.spyOn(api, 'walletSend');
    render(<SendPage />);
    expect(screen.getByTestId('send-unavailable-banner')).toBeInTheDocument();
    expect(screen.getByTestId('send-submit-btn')).toBeDisabled();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(walletSendSpy).not.toHaveBeenCalled();
  });

  it('does not expose recipient/amount inputs that could trigger a send', () => {
    render(<SendPage />);
    expect(screen.queryByTestId('send-recipient-input')).toBeNull();
    expect(screen.queryByTestId('send-amount-input')).toBeNull();
    expect(screen.queryByTestId('send-confirm-btn')).toBeNull();
  });

  it('redirects home when no account after the grace timeout', async () => {
    vi.useFakeTimers();
    useWalletStore.setState({ account: null, hasStoredWallet: false });
    render(<SendPage />);
    expect(screen.getByTestId('redirecting-placeholder')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(routerReplace).toHaveBeenCalledWith('/');
  });
});
