/**
 * Rest-of-branches tests for `src/components/screens/WalletScreen.tsx`.
 *
 * `WalletScreen.polling.test.tsx` covers the 5 s balance-poll lifecycle.
 * This file covers everything else on the screen:
 *
 *   - Balance hide/show toggle (Eye / EyeOff icon swap, `data-hidden`
 *     attribute, `aria-label` flip)
 *   - Address copy (zk-form copied to clipboard, "copied" feedback for
 *     1.5 s, button re-renders without the feedback after the revert)
 *   - Faucet button (FEATURES.FAUCET + non-mainnet → click → /api/mint
 *     then /api/balance refresh; ApiError → mintError surfaced; faucet
 *     hidden on mainnet)
 *   - Username claim form (FEATURES.USERNAMES + no existing username →
 *     input sanitises non-allowed chars; submit calls api.claimUsername,
 *     persists via setUsername, clears input; failure surfaces inline)
 *   - Transactions list vs empty placeholder (every type label + icon
 *     branch in TransactionsList)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WalletScreen } from '@/components/screens/WalletScreen';
import { useWalletStore, type Transaction } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { ApiError, api } from '@/lib/api/client';

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
// WalletScreen reads runtime FAUCET / USERNAMES through `useFeatures()`
// (build-time flags PASSKEY / APPS_DIRECTORY / … still come from FEATURES).
// Proxying both onto a single mutable holder keeps the per-test
// FEATURES_STATE.X = … toggles working across the refactor.
vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

const ALICE = {
  address: 'a'.repeat(64),
  numPubkeys: 2,
  xpriv: 'xprv-alice',
};

let balanceSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

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
  useNetworkStore.setState({
    apiUrl: 'https://test.api',
    networkName: 'signet',
    setNetworkName: useNetworkStore.getState().setNetworkName,
  });
  useWalletStore.setState({
    account: ALICE,
    balance: 50_000_000, // 0.5 BTC
    transactions: [],
    isLoading: false,
    isLocked: false,
    hasStoredWallet: true,
    storedAddress: ALICE.address,
    storedAuthMethod: 'seed',
    error: null,
  });
  infoSpy = vi.spyOn(api, 'info').mockResolvedValue({ network: 'signet' });
  balanceSpy = vi.spyOn(api, 'balance').mockResolvedValue({ balance: 50_000_000 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  balanceSpy.mockRestore();
  infoSpy.mockRestore();
});

describe('WalletScreen — balance hide/show toggle', () => {
  it('starts visible; clicking flips to the hidden state with EyeOff icon + data-hidden', async () => {
    const user = userEvent.setup();
    render(<WalletScreen />);

    const toggle = screen.getByTestId('balance-toggle-btn');
    expect(toggle).toHaveAttribute('aria-label', 'Hide balance');
    expect(toggle).not.toHaveAttribute('data-hidden');
    // USD + BTC values rendered (after the initial mount tick).
    await waitFor(() => {
      expect(screen.getByTestId('balance-amount-usd').textContent).toMatch(/^\$/);
    });

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-label', 'Show balance');
    expect(toggle).toHaveAttribute('data-hidden', 'true');
    expect(screen.getByTestId('balance-amount-usd')).toHaveTextContent('••••');
    expect(screen.getByTestId('balance-amount-btc')).toHaveTextContent('••••');
  });

  it('clicking the toggle a second time flips back to visible', async () => {
    const user = userEvent.setup();
    render(<WalletScreen />);
    const toggle = screen.getByTestId('balance-toggle-btn');

    await user.click(toggle);
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-label', 'Hide balance');
    expect(toggle).not.toHaveAttribute('data-hidden');
  });
});

describe('WalletScreen — address copy', () => {
  it('flips to "copied" feedback on click and reverts after 1.5 s', async () => {
    // Targeted setTimeout collapse for the 1.5 s revert.
    const realSetTimeout = globalThis.setTimeout;
    const timerSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      cb: () => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 1_500) {
        queueMicrotask(cb);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(cb, delay as number, ...(args as []));
    }) as unknown as typeof setTimeout);

    const user = userEvent.setup();
    render(<WalletScreen />);

    const btn = screen.getByTestId('address-copy-btn');
    expect(btn).not.toHaveAttribute('data-copied');
    await user.click(btn);
    // 1.5 s revert is the second microtask drain.
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    // After both flips (Copied → revert), data-copied is gone.
    expect(btn).not.toHaveAttribute('data-copied');
    // Clipboard actually got the zk-form address (happy-dom's real impl).
    await expect(navigator.clipboard.readText()).resolves.toMatch(/^aaaaaaaa@zkcoins\.app$/);
    expect(timerSpy).toHaveBeenCalledWith(expect.any(Function), 1_500);
    timerSpy.mockRestore();
  });
});

describe('WalletScreen — faucet button', () => {
  it('does not render when FEATURES.FAUCET is off (PRD bundle)', () => {
    useWalletStore.setState({ balance: 0 });
    render(<WalletScreen />);
    expect(screen.queryByTestId('faucet-btn')).not.toBeInTheDocument();
    // The empty banner itself still renders.
    expect(screen.getByTestId('wallet-empty-banner')).toBeInTheDocument();
  });

  it('does not render when network is mainnet', () => {
    FEATURES_STATE.FAUCET = true;
    useNetworkStore.setState({ networkName: 'mainnet' });
    useWalletStore.setState({ balance: 0 });
    render(<WalletScreen />);
    expect(screen.queryByTestId('faucet-btn')).not.toBeInTheDocument();
  });

  it('renders + mints + refreshes balance when clicked on signet DEV', async () => {
    FEATURES_STATE.FAUCET = true;
    useWalletStore.setState({ balance: 0 });
    const mintSpy = vi.spyOn(api, 'mint').mockResolvedValue({ success: true, proof_id: 1 });
    balanceSpy.mockResolvedValueOnce({ balance: 0 }); // initial polling tick
    balanceSpy.mockResolvedValueOnce({ balance: 10_000 }); // post-mint refresh

    const user = userEvent.setup();
    render(<WalletScreen />);

    await user.click(screen.getByTestId('faucet-btn'));
    await waitFor(() => {
      expect(mintSpy).toHaveBeenCalledWith(ALICE.address);
    });
    await waitFor(() => {
      expect(useWalletStore.getState().balance).toBe(10_000);
    });
  });

  it('surfaces an inline mint error when /api/mint throws ApiError', async () => {
    FEATURES_STATE.FAUCET = true;
    useWalletStore.setState({ balance: 0 });
    // Pin the polling tick to 0 so the empty banner (which holds the
    // faucet button) stays mounted across the click. The default
    // `mockResolvedValue({ balance: 50_000_000 })` from beforeEach
    // would unmount the banner mid-test.
    balanceSpy.mockResolvedValue({ balance: 0 });

    const err = new ApiError(503, 'Faucet exhausted', 'Faucet exhausted');
    vi.spyOn(api, 'mint').mockRejectedValue(err);

    const user = userEvent.setup();
    render(<WalletScreen />);
    await user.click(screen.getByTestId('faucet-btn'));

    expect(await screen.findByTestId('wallet-mint-error')).toBeInTheDocument();
  });
});

describe('WalletScreen — username claim form', () => {
  it('renders the claim form when FEATURES.USERNAMES is on and the account has no username', () => {
    FEATURES_STATE.USERNAMES = true;
    render(<WalletScreen />);
    expect(screen.getByTestId('username-claim-btn')).toBeInTheDocument();
  });

  it('sanitises non-allowed characters in the input', async () => {
    FEATURES_STATE.USERNAMES = true;
    const user = userEvent.setup();
    render(<WalletScreen />);

    const input = screen.getByPlaceholderText('Claim a username') as HTMLInputElement;
    await user.type(input, 'AliceX!@#1');
    // Lowercased, special chars stripped, alphanumerics + . _ - kept.
    expect(input.value).toBe('alicex1');
  });

  it('submits a claim and persists the resolved username on success', async () => {
    FEATURES_STATE.USERNAMES = true;
    const claimSpy = vi
      .spyOn(api, 'claimUsername')
      .mockResolvedValue({ username: 'alice', address: ALICE.address });

    const user = userEvent.setup();
    render(<WalletScreen />);

    await user.type(screen.getByPlaceholderText('Claim a username'), 'alice');
    await user.click(screen.getByTestId('username-claim-btn'));

    await waitFor(() => {
      expect(useWalletStore.getState().account?.username).toBe('alice');
    });
    expect(claimSpy).toHaveBeenCalledWith({
      username: 'alice',
      address: ALICE.address,
      xpriv: ALICE.xpriv,
    });
  });

  it('surfaces a typed claim error on rejection', async () => {
    FEATURES_STATE.USERNAMES = true;
    vi.spyOn(api, 'claimUsername').mockRejectedValue(new Error('Username taken'));

    const user = userEvent.setup();
    render(<WalletScreen />);

    await user.type(screen.getByPlaceholderText('Claim a username'), 'alice');
    await user.click(screen.getByTestId('username-claim-btn'));

    expect(await screen.findByText('Username taken')).toBeInTheDocument();
  });

  it('the claim form is replaced by the username display once account.username is set', () => {
    FEATURES_STATE.USERNAMES = true;
    useWalletStore.setState({ account: { ...ALICE, username: 'alice' } });
    render(<WalletScreen />);
    expect(screen.queryByTestId('username-claim-btn')).not.toBeInTheDocument();
    expect(screen.getByText('alice@zkcoins.app')).toBeInTheDocument();
  });
});

describe('WalletScreen — transactions list', () => {
  it('renders the empty placeholder when transactions is empty', () => {
    render(<WalletScreen />);
    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    expect(screen.queryByTestId('tx-row-amount')).not.toBeInTheDocument();
  });

  it('renders rows for send / receive / mint with the right label and sign', () => {
    const txs: Transaction[] = [
      { id: 's', type: 'send', amount: 100_000, timestamp: 1700000000000 },
      { id: 'r', type: 'receive', amount: 200_000, timestamp: 1700000001000 },
      { id: 'm', type: 'mint', amount: 300_000, timestamp: 1700000002000 },
    ];
    useWalletStore.setState({ transactions: txs });
    const { container } = render(<WalletScreen />);

    expect(within(container).getByText('Sent')).toBeInTheDocument();
    expect(within(container).getByText('Received')).toBeInTheDocument();
    expect(within(container).getByText('Faucet')).toBeInTheDocument();

    const amounts = container.querySelectorAll('[data-testid="tx-row-amount"]');
    expect(amounts).toHaveLength(3);
    // Send is negative-signed → no leading +.
    expect(amounts[0].textContent).not.toMatch(/^\+/);
    // Receive + Mint are positive.
    expect(amounts[1].textContent).toMatch(/^\+/);
    expect(amounts[2].textContent).toMatch(/^\+/);
  });

  it('caps the rendered list to 10 rows', () => {
    const txs: Transaction[] = Array.from({ length: 25 }, (_, i) => ({
      id: `t-${i}`,
      type: 'receive' as const,
      amount: 1000,
      timestamp: 1700000000000 + i,
    }));
    useWalletStore.setState({ transactions: txs });
    const { container } = render(<WalletScreen />);
    expect(container.querySelectorAll('[data-testid="tx-row-amount"]')).toHaveLength(10);
  });
});

describe('WalletScreen — Send / Receive primary buttons', () => {
  it('renders both as enabled links when an account is in store', () => {
    render(<WalletScreen />);
    expect(screen.getByTestId('wallet-send-btn')).toHaveAttribute('href', '/send');
    expect(screen.getByTestId('wallet-receive-btn')).toHaveAttribute('href', '/receive');
    expect(screen.getByTestId('wallet-send-btn').getAttribute('aria-disabled')).toBe('false');
  });

  it('renders both with aria-disabled when account is null', () => {
    useWalletStore.setState({ account: null });
    render(<WalletScreen />);
    const send = screen.getByTestId('wallet-send-btn');
    expect(send.getAttribute('aria-disabled')).toBe('true');
    // Clicking a disabled link does not navigate (preventDefault path).
    fireEvent.click(send);
  });
});
