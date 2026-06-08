/**
 * Portfolio-polling + create-coin entry in
 * `src/components/screens/WalletScreen.tsx`.
 *
 * Under the neutral multi-asset model the home screen renders the owner's
 * asset list from `GET /api/balance/:address` (via `usePortfolio`) rather
 * than a single BTC balance. These tests cover:
 *   - mount → portfolio fetched + asset list rendered
 *   - empty portfolio → empty banner
 *   - account swap → re-fetch keyed to the new address
 *   - /api/info network + username_domain pinned on mount
 *   - the create-coin entry replaces the old faucet
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { render } from '@/__tests__/_helpers/intl';
import { WalletScreen } from '@/components/screens/WalletScreen';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { api, type OwnerBalanceResponse } from '@/lib/api/client';

const FEATURES_STATE = vi.hoisted(() => ({
  APPS_DIRECTORY: false,
  PASSKEY: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
  USERNAME_CLAIM: false,
  // Runtime multi-asset capability ON: this suite asserts the per-asset
  // portfolio + create-coin entry, which only render on the true surface.
  MULTI_ASSET: true,
}));

vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

const ALICE = { address: 'a'.repeat(64), numPubkeys: 0, xpriv: 'xprv-alice' };
const BOB = { address: 'b'.repeat(64), numPubkeys: 0, xpriv: 'xprv-bob' };

const ASSET_ID = 'c'.repeat(64);

function portfolio(overrides: Partial<OwnerBalanceResponse> = {}): OwnerBalanceResponse {
  return {
    address: ALICE.address,
    assets: [{ asset_id: ASSET_ID, name: 'MyCoin', decimals: 2, balance: 12_345, num_sends: 0 }],
    ...overrides,
  };
}

let ownerSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;
let historySpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  Object.assign(FEATURES_STATE, { USERNAME_CLAIM: false, MULTI_ASSET: true });
  useNetworkStore.setState({ apiUrl: 'https://test.api', networkName: '', bitcoinNetwork: '' });
  useWalletStore.setState({
    account: ALICE,
    balance: null,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    error: null,
  });
  infoSpy = vi
    .spyOn(api, 'info')
    .mockResolvedValue({ network: 'Mutinynet', username_domain: 'local.zkcoins.test' });
  ownerSpy = vi.spyOn(api, 'ownerBalances');
  historySpy = vi
    .spyOn(api, 'getHistory')
    .mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  ownerSpy.mockRestore();
  infoSpy.mockRestore();
  historySpy.mockRestore();
});

describe('WalletScreen — portfolio', () => {
  it('fetches the portfolio on mount and renders the asset list', async () => {
    ownerSpy.mockResolvedValue(portfolio());

    const { findByTestId, getAllByTestId } = render(<WalletScreen />);

    expect(await findByTestId('asset-list')).toBeTruthy();
    expect(getAllByTestId('asset-row').length).toBe(1);
    expect(ownerSpy).toHaveBeenCalledWith(ALICE.address);
  });

  it('renders the empty banner when the owner holds no assets', async () => {
    ownerSpy.mockResolvedValue(portfolio({ assets: [] }));

    const { findByTestId, queryByTestId } = render(<WalletScreen />);
    expect(await findByTestId('wallet-empty-banner')).toBeTruthy();
    expect(queryByTestId('asset-list')).toBeNull();
  });

  it('re-fetches against the new address when the account changes', async () => {
    ownerSpy.mockResolvedValue(portfolio({ assets: [] }));

    vi.useFakeTimers();
    render(<WalletScreen />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(ownerSpy).toHaveBeenLastCalledWith(ALICE.address);

    act(() => {
      useWalletStore.setState({ account: BOB });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(ownerSpy).toHaveBeenLastCalledWith(BOB.address);
  });

  it('does not fetch when there is no account', async () => {
    useWalletStore.setState({ account: null });
    ownerSpy.mockResolvedValue(portfolio({ assets: [] }));

    vi.useFakeTimers();
    render(<WalletScreen />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(ownerSpy).not.toHaveBeenCalled();
  });

  it('renders the asset row from the first successful poll', async () => {
    // Per-poll error resilience (last-good-list retention) is covered in
    // usePortfolio.test.tsx; here we just assert the screen renders the
    // first successful portfolio.
    ownerSpy.mockResolvedValue(portfolio());
    const { findByTestId, getAllByTestId } = render(<WalletScreen />);
    await findByTestId('asset-list');
    expect(getAllByTestId('asset-row').length).toBe(1);
  });

  it('writes network + username_domain from /api/info on mount', async () => {
    ownerSpy.mockResolvedValue(portfolio({ assets: [] }));
    infoSpy.mockResolvedValue({
      network: 'Mutinynet',
      bitcoin_network: 'mutinynet',
      username_domain: 'local.zkcoins.test',
    });

    render(<WalletScreen />);
    await waitFor(() => {
      expect(useNetworkStore.getState().networkName).toBe('Mutinynet');
      expect(useNetworkStore.getState().bitcoinNetwork).toBe('mutinynet');
      expect(useNetworkStore.getState().usernameDomain).toBe('local.zkcoins.test');
    });
  });
});

describe('WalletScreen — create-coin entry', () => {
  it('renders the create-coin button (replacing the faucet)', async () => {
    ownerSpy.mockResolvedValue(portfolio({ assets: [] }));
    const { findByTestId, queryByTestId } = render(<WalletScreen />);
    expect(await findByTestId('create-coin-btn')).toBeTruthy();
    // The old faucet button is gone.
    expect(queryByTestId('faucet-btn')).toBeNull();
  });
});
