/**
 * Single-asset surface of `src/components/screens/WalletScreen.tsx`
 * (capability-adaptive client, `multi_asset:false`).
 *
 * Against a single-asset node the home screen renders the BTC balance hero
 * (USD/BTC value + eye toggle), the empty-wallet banner with the testnet
 * faucet, and a single-asset transaction list — NOT the per-asset portfolio.
 * These tests cover:
 *   - balance hero renders the polled `api.walletBalance` value
 *   - the eye toggle hides/shows the value
 *   - empty wallet (balance 0) shows the faucet, which mints + re-polls
 *   - the create-coin entry is NOT shown (multi-asset only)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
import { WalletScreen } from '@/components/screens/WalletScreen';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { api } from '@/lib/api/client';

const FEATURES_STATE = vi.hoisted(() => ({
  APPS_DIRECTORY: false,
  PASSKEY: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
  USERNAME_CLAIM: false,
  // Runtime multi-asset capability OFF → single-asset surface.
  MULTI_ASSET: false,
}));

vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

const ALICE = { address: 'a'.repeat(64), numPubkeys: 0, xpriv: 'xprv-alice' };

let balanceSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;
let historySpy: ReturnType<typeof vi.spyOn>;
let mintSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  Object.assign(FEATURES_STATE, {
    USERNAME_CLAIM: false,
    MULTI_ASSET: false,
    APPS_DIRECTORY: false,
  });
  useNetworkStore.setState({
    apiUrl: 'https://test.api',
    networkName: 'Mutinynet',
    bitcoinNetwork: 'mutinynet',
  });
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
  balanceSpy = vi.spyOn(api, 'walletBalance');
  historySpy = vi
    .spyOn(api, 'getHistory')
    .mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  mintSpy = vi.spyOn(api, 'mint');
});

afterEach(() => {
  vi.useRealTimers();
  balanceSpy.mockRestore();
  infoSpy.mockRestore();
  historySpy.mockRestore();
  mintSpy.mockRestore();
});

describe('WalletScreen — single-asset balance hero', () => {
  it('polls walletBalance on mount and renders the BTC/USD hero', async () => {
    balanceSpy.mockResolvedValue({ balance: 100_000, num_sends: 0 });
    const { findByTestId } = render(<WalletScreen />);

    const usd = await findByTestId('balance-amount-usd');
    await waitFor(() => {
      expect(usd).not.toHaveAttribute('data-loading', 'true');
    });
    expect(balanceSpy).toHaveBeenCalledWith(ALICE.address);
    // The portfolio / create-coin entry must NOT render on the single-asset surface.
    expect(document.querySelector('[data-testid="asset-list"]')).toBeNull();
    expect(document.querySelector('[data-testid="create-coin-btn"]')).toBeNull();
  });

  it('hides the value when the eye toggle is pressed', async () => {
    balanceSpy.mockResolvedValue({ balance: 100_000, num_sends: 0 });
    const user = userEvent.setup();
    const { findByTestId } = render(<WalletScreen />);

    const toggle = await findByTestId('balance-toggle-btn');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('data-hidden', 'true');
  });

  it('shows the faucet on an empty wallet and re-polls after minting', async () => {
    // First tick: empty. After mint: funded.
    balanceSpy
      .mockResolvedValueOnce({ balance: 0, num_sends: 0 })
      .mockResolvedValue({ balance: 10_000, num_sends: 0 });
    mintSpy.mockResolvedValue({
      job_id: 'mint-1',
      status: 'completed',
      phase: 'completed',
      result: { success: true },
    });
    const user = userEvent.setup();
    const { findByTestId } = render(<WalletScreen />);

    const faucet = await findByTestId('faucet-btn');
    await act(async () => {
      await user.click(faucet);
    });
    expect(mintSpy).toHaveBeenCalledWith(ALICE.address);
    await waitFor(() => {
      expect(balanceSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('surfaces a faucet ApiError inline without re-throwing', async () => {
    const { ApiError } = await import('@/lib/api/client');
    balanceSpy.mockResolvedValue({ balance: 0, num_sends: 0 });
    mintSpy.mockRejectedValue(new ApiError(503, 'faucet unavailable', '{}'));
    const user = userEvent.setup();
    const { findByTestId } = render(<WalletScreen />);

    const faucet = await findByTestId('faucet-btn');
    await act(async () => {
      await user.click(faucet);
    });
    expect(await findByTestId('wallet-mint-error')).toBeInTheDocument();
  });
});
