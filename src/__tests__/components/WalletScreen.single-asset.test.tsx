/**
 * Single-asset surface of WalletScreen when MULTI_ASSET is false.
 *
 * Balance reads are not available in this build — the hero must show an
 * honest "not available" state, never a fabricated 0 / empty wallet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
import { WalletScreen } from '@/components/screens/WalletScreen';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { ApiError, api } from '@/lib/api/client';

const FEATURES_STATE = vi.hoisted(() => ({
  APPS_DIRECTORY: false,
  PASSKEY: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
  USERNAME_CLAIM: false,
  MULTI_ASSET: false,
}));

vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

const ALICE = {
  address: 'a'.repeat(64),
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};

let infoSpy: ReturnType<typeof vi.spyOn>;
let historySpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  Object.assign(FEATURES_STATE, {
    USERNAME_CLAIM: false,
    MULTI_ASSET: false,
    APPS_DIRECTORY: false,
  });
  useNetworkStore.setState({
    apiUrl: 'https://test.api',
    network: 'regtest',
    infoError: null,
    infoLoaded: true,
    usernameDomain: 'local.zkcoins.test',
  });
  useWalletStore.setState({
    account: ALICE,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    error: null,
  });
  infoSpy = vi.spyOn(api, 'info').mockResolvedValue({
    network: 'regtest',
    features: [],
    protocol_version: 'v1',
    username_domain: 'local.zkcoins.test',
  });
  vi.spyOn(api, 'walletBalance').mockRejectedValue(
    new ApiError(501, 'wallet balance not available in this build'),
  );
  historySpy = vi
    .spyOn(api, 'getHistory')
    .mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WalletScreen — single-asset balance unavailable', () => {
  it('shows the honest not-available hero, not a $0 empty wallet', async () => {
    const { findByTestId, queryByTestId } = render(<WalletScreen />);
    const usd = await findByTestId('balance-amount-usd');
    expect(usd).toHaveAttribute('data-unavailable', 'true');
    expect(await findByTestId('balance-unavailable-banner')).toBeInTheDocument();
    // Empty-wallet faucet path must NOT appear (that implies balance === 0 truth).
    expect(queryByTestId('faucet-btn')).toBeNull();
    expect(queryByTestId('wallet-empty-banner')).toBeNull();
    expect(queryByTestId('asset-list')).toBeNull();
    expect(queryByTestId('create-coin-btn')).toBeNull();
    void infoSpy;
    void historySpy;
  });

  it('hides the not-available text when the eye toggle is pressed', async () => {
    const user = userEvent.setup();
    const { findByTestId } = render(<WalletScreen />);
    const toggle = await findByTestId('balance-toggle-btn');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('data-hidden', 'true');
  });

  it('hides name claim and shows the unavailable note', async () => {
    const { findByTestId, queryByTestId } = render(<WalletScreen />);
    expect(await findByTestId('name-claim-unavailable')).toBeInTheDocument();
    expect(queryByTestId('username-claim-btn')).toBeNull();
    expect(queryByTestId('name-setup-input')).toBeNull();
  });

  it('copies a configured display name, shows feedback, then clears it', async () => {
    vi.useFakeTimers();
    useWalletStore.setState({ account: { ...ALICE, username: 'alice' } });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<WalletScreen />);
    await vi.runAllTicks();
    fireEvent.click(screen.getByTestId('address-copy-btn'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(writeText).toHaveBeenCalledWith('alice@local.zkcoins.test');
    expect(screen.getByTestId('address-copied-feedback')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByTestId('address-copied-feedback')).not.toBeInTheDocument();
  });

  it('leaves copy feedback hidden when clipboard access rejects', async () => {
    useWalletStore.setState({ account: { ...ALICE, username: 'alice' } });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    render(<WalletScreen />);
    fireEvent.click(await screen.findByTestId('address-copy-btn'));
    await waitFor(() => expect(screen.queryByTestId('address-copied-feedback')).toBeNull());
  });

  it('removes the copy button when the account-gated claim row unmounts', async () => {
    useWalletStore.setState({ account: { ...ALICE, username: 'alice' } });
    render(<WalletScreen />);
    await screen.findByTestId('address-copy-btn');

    act(() => useWalletStore.setState({ account: null }));

    expect(screen.queryByTestId('address-copy-btn')).not.toBeInTheDocument();
  });

  it('formats a numeric history amount as BTC in single-asset mode', async () => {
    historySpy.mockResolvedValue({
      items: [
        {
          id: 7,
          kind: 'send',
          amount: 50_000,
          status: 'pending',
          created_at: 1_780_000_000,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(<WalletScreen />);
    expect(await screen.findByTestId('tx-row-amount')).toHaveTextContent('BTC');
  });

  it('maps a non-Error info rejection to the fail-closed fallback message', async () => {
    infoSpy.mockRejectedValue('offline');
    render(<WalletScreen />);
    expect(await screen.findByTestId('network-info-error')).toHaveTextContent(
      'failed to load /v1/info',
    );
  });

  it('runs disabled and enabled primary-button click handlers', async () => {
    render(<WalletScreen />);
    const send = await screen.findByTestId('wallet-send-btn');
    const receive = screen.getByTestId('wallet-receive-btn');
    fireEvent.click(send);
    fireEvent.click(receive);
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(receive).toHaveAttribute('aria-disabled', 'false');
  });
});
