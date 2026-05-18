/**
 * Balance-polling effect in `src/components/screens/WalletScreen.tsx`.
 *
 * The component fires `api.balance(address)` on mount and every 5 s
 * thereafter; the result lands in the wallet store. The polling effect
 * is the only background work in the wallet UI, and it never had a
 * unit test before — the existing e2e screenshots only assert the
 * post-poll balance shape, not the timing semantics, the cleanup
 * behaviour, or the account-swap path.
 *
 * Tests in this file:
 *   - mount → balance set
 *   - 5 s interval → next balance set
 *   - account swap → new interval keyed to the new address
 *   - unmount → no further ticks
 *   - silent error → balance unchanged, no rethrow
 *   - username assignment (first-only — server is the source of truth)
 *
 * The component also calls `api.info` on mount; that is mocked to
 * resolve once so it doesn't intercept the balance assertions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
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
}));

// `FEATURES` exposes build-time client flags only; runtime opt-in
// capabilities (`USERNAME_CLAIM`, …) are served by `useFeatures()`.
// The holder backs both so tests can keep flipping a single object.
vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

const ALICE = {
  address: 'a'.repeat(64),
  numPubkeys: 0,
  xpriv: 'xprv-alice',
};
const BOB = {
  address: 'b'.repeat(64),
  numPubkeys: 0,
  xpriv: 'xprv-bob',
};

let balanceSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  Object.assign(FEATURES_STATE, {
    APPS_DIRECTORY: false,
    PASSKEY: false,
    DEV_ROUTES: false,
    AUTO_LOCK: false,
    ADDRESS_ROTATION: false,
    TOR_ROUTING: false,
    USERNAME_CLAIM: false,
  });
  useNetworkStore.setState({
    apiUrl: 'https://test.api',
    networkName: '',
    setNetworkName: useNetworkStore.getState().setNetworkName,
  });
  useWalletStore.setState({
    account: ALICE,
    balance: null,
    transactions: [],
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    error: null,
  });
  // `api.info` is called on mount — return a benign value so it doesn't
  // race the balance assertions. `mockResolvedValue` (not Once) covers any
  // number of mounts/unmounts in a single test.
  infoSpy = vi
    .spyOn(api, 'info')
    .mockResolvedValue({ network: 'signet', username_domain: 'zkcoins.app' });
  balanceSpy = vi.spyOn(api, 'balance');
});

afterEach(() => {
  vi.useRealTimers();
  balanceSpy.mockRestore();
  infoSpy.mockRestore();
});

describe('WalletScreen — balance polling', () => {
  it('fetches the balance on mount and writes it to the store', async () => {
    balanceSpy.mockResolvedValue({ balance: 12_345, num_sends: 0 });

    render(<WalletScreen />);

    await waitFor(() => {
      expect(useWalletStore.getState().balance).toBe(12_345);
    });
    expect(balanceSpy).toHaveBeenCalledWith(ALICE.address);
  });

  it('fires the next tick exactly 5 s after the previous one', async () => {
    balanceSpy
      .mockResolvedValueOnce({ balance: 100, num_sends: 0 })
      .mockResolvedValueOnce({ balance: 200, num_sends: 0 })
      .mockResolvedValueOnce({ balance: 300, num_sends: 0 });

    vi.useFakeTimers();
    render(<WalletScreen />);

    // First tick — fires immediately on mount.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(useWalletStore.getState().balance).toBe(100);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(useWalletStore.getState().balance).toBe(200);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(useWalletStore.getState().balance).toBe(300);
    expect(balanceSpy).toHaveBeenCalledTimes(3);
  });

  it('does not fire any tick after the component unmounts', async () => {
    balanceSpy.mockResolvedValue({ balance: 100, num_sends: 0 });

    vi.useFakeTimers();
    const { unmount } = render(<WalletScreen />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(balanceSpy).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // No further calls even after a full minute of idle wall time.
    expect(balanceSpy).toHaveBeenCalledTimes(1);
  });

  it('does not poll when the store has no account', async () => {
    useWalletStore.setState({ account: null });
    balanceSpy.mockResolvedValue({ balance: 0, num_sends: 0 });

    vi.useFakeTimers();
    render(<WalletScreen />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(balanceSpy).not.toHaveBeenCalled();
  });

  it('restarts polling against the new address when the account changes', async () => {
    balanceSpy.mockResolvedValue({ balance: 0, num_sends: 0 });

    vi.useFakeTimers();
    render(<WalletScreen />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(balanceSpy).toHaveBeenLastCalledWith(ALICE.address);

    act(() => {
      useWalletStore.setState({ account: BOB });
    });
    // Account-swap effect re-runs synchronously; the mount tick of the
    // new effect fires before any interval advance.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(balanceSpy).toHaveBeenLastCalledWith(BOB.address);
  });

  it('swallows a thrown balance error and leaves the store balance untouched', async () => {
    useWalletStore.setState({ balance: 999 });
    balanceSpy.mockRejectedValue(new Error('boom'));

    render(<WalletScreen />);
    await waitFor(() => {
      expect(balanceSpy).toHaveBeenCalled();
    });
    // Balance was not flipped to null by the failed fetch.
    expect(useWalletStore.getState().balance).toBe(999);
  });

  it('sets username on first response when account has no username yet', async () => {
    balanceSpy.mockResolvedValue({ balance: 1, username: 'alice', num_sends: 0 });

    render(<WalletScreen />);
    await waitFor(() => {
      expect(useWalletStore.getState().account?.username).toBe('alice');
    });
  });

  it('leaves the local username unset when the server response omits one', async () => {
    balanceSpy.mockResolvedValue({ balance: 1, num_sends: 0 });

    render(<WalletScreen />);
    await waitFor(() => {
      expect(useWalletStore.getState().balance).toBe(1);
    });
    expect(useWalletStore.getState().account?.username).toBeUndefined();
  });

  it('does not overwrite an existing username on later ticks', async () => {
    useWalletStore.setState({ account: { ...ALICE, username: 'pinned' } });
    balanceSpy.mockResolvedValue({ balance: 1, username: 'different', num_sends: 0 });

    vi.useFakeTimers();
    render(<WalletScreen />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(useWalletStore.getState().account?.username).toBe('pinned');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(useWalletStore.getState().account?.username).toBe('pinned');
  });

  it('writes the network name and username_domain from /api/info on mount', async () => {
    infoSpy.mockResolvedValue({ network: 'mainnet', username_domain: 'zkcoins.app' });
    balanceSpy.mockResolvedValue({ balance: 0, num_sends: 0 });

    render(<WalletScreen />);
    await waitFor(() => {
      expect(useNetworkStore.getState().networkName).toBe('mainnet');
      expect(useNetworkStore.getState().usernameDomain).toBe('zkcoins.app');
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });
});

describe('WalletScreen — faucet button gating', () => {
  it('hides the faucet button when the node reports network "Mainnet" (CamelCase)', async () => {
    // The node ships network names as display strings — see
    // `node::router::info_handler` — and Mainnet is the only value
    // the faucet must never appear on. Casing was the regression
    // vector: `"Mainnet" !== "mainnet"` rendered the faucet on PRD.
    infoSpy.mockResolvedValue({ network: 'Mainnet' });
    balanceSpy.mockResolvedValue({ balance: 0 });

    const { queryByTestId } = render(<WalletScreen />);
    await waitFor(() => {
      expect(useNetworkStore.getState().networkName).toBe('Mainnet');
    });
    await waitFor(() => {
      expect(useWalletStore.getState().balance).toBe(0);
    });
    expect(queryByTestId('faucet-btn')).toBeNull();
  });

  it('renders the faucet button on a testnet (e.g. Mutinynet) with empty balance', async () => {
    infoSpy.mockResolvedValue({ network: 'Mutinynet' });
    balanceSpy.mockResolvedValue({ balance: 0 });

    const { findByTestId } = render(<WalletScreen />);
    expect(await findByTestId('faucet-btn')).toBeTruthy();
  });
});
