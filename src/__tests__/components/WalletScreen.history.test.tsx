/**
 * Transaction-list rendering in `WalletScreen` from server `/api/history`
 * truth (issue #175). Complements `WalletScreen.polling.test.tsx` (balance
 * cadence) by exercising the list/empty-state gating and the per-row
 * mapping of the node's `HistoryItem` shape (direction → label/sign,
 * Unix-seconds timestamp).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WalletScreen } from '@/components/screens/WalletScreen';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { api, type HistoryItem } from '@/lib/api/client';

const FEATURES_STATE = vi.hoisted(() => ({
  APPS_DIRECTORY: false,
  PASSKEY: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
  USERNAME_CLAIM: false,
}));

vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

const ALICE = { address: 'a'.repeat(64), numPubkeys: 0, xpriv: 'xprv-alice' };

function row(over: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: 1,
    txid: null,
    timestamp: 1_780_000_000,
    direction: 'mint',
    amount: 10_000,
    counterparty: null,
    status: 'pending',
    block_height: null,
    memo: null,
    ...over,
  };
}

let historySpy: ReturnType<typeof vi.spyOn>;

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
    networkName: 'signet',
    bitcoinNetwork: 'mutinynet',
  });
  useWalletStore.setState({
    account: ALICE,
    balance: 10_000,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    error: null,
  });
  vi.spyOn(api, 'info').mockResolvedValue({ network: 'signet', bitcoin_network: 'mutinynet' });
  vi.spyOn(api, 'balance').mockResolvedValue({ balance: 10_000, num_sends: 0 });
  historySpy = vi.spyOn(api, 'getHistory');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('WalletScreen — transaction list from server history', () => {
  it('renders the faucet mint row for a funded wallet without any local action', async () => {
    historySpy.mockResolvedValue({ items: [row()], total: 1, limit: 50, offset: 0 });

    render(<WalletScreen />);

    expect(await screen.findByText('Faucet')).toBeInTheDocument();
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();
    expect(screen.getByTestId('tx-row-amount')).toBeInTheDocument();
  });

  it('maps direction to label and sign (mint, receive credit; send debit)', async () => {
    historySpy.mockResolvedValue({
      items: [
        row({ id: 1, direction: 'mint', amount: 10_000 }),
        row({ id: 2, direction: 'receive', amount: 25_000 }),
        row({ id: 3, direction: 'send', amount: 5_000 }),
      ],
      total: 3,
      limit: 50,
      offset: 0,
    });

    render(<WalletScreen />);

    expect(await screen.findByText('Faucet')).toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();

    const amounts = screen.getAllByTestId('tx-row-amount').map((n) => n.textContent ?? '');
    // The send row is the only debit → the only one rendered with the
    // Unicode minus (U+2212); the two credits carry a leading '+'.
    expect(amounts.filter((t) => t.includes('−'))).toHaveLength(1);
    expect(amounts.filter((t) => t.includes('+'))).toHaveLength(2);
  });

  it('renders the row time from a Unix-seconds timestamp (not raw ms)', async () => {
    // 1_780_000_000 s → a real wall-clock time; the raw value treated as ms
    // would render an epoch-1970 time. Assert a valid HH:MM, never "Invalid".
    historySpy.mockResolvedValue({ items: [row()], total: 1, limit: 50, offset: 0 });

    render(<WalletScreen />);

    const time = await screen.findByTestId('tx-row-time');
    expect(time.textContent).toMatch(/^\d{1,2}:\d{2}/);
    expect(time.textContent).not.toContain('Invalid');
  });

  it('shows the empty state once history has loaded and is genuinely empty', async () => {
    historySpy.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });

    render(<WalletScreen />);

    expect(await screen.findByText('No transactions yet')).toBeInTheDocument();
  });

  it('holds the empty state back while the first history fetch is in flight', async () => {
    // Never-resolving fetch → loaded stays false → neither the list nor the
    // empty placeholder renders (no "No transactions yet" flash on a funded
    // wallet whose first /api/history round-trip has not landed yet).
    historySpy.mockReturnValue(new Promise<never>(() => {}));

    render(<WalletScreen />);

    // Balance area confirms the screen mounted.
    await waitFor(() => expect(screen.getByTestId('balance-amount-usd')).toBeInTheDocument());
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tx-row-amount')).not.toBeInTheDocument();
  });

  it('prompts to create a wallet when there is no account', async () => {
    useWalletStore.setState({ account: null, balance: null });
    historySpy.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });

    render(<WalletScreen />);

    expect(await screen.findByText('Create a wallet to get started.')).toBeInTheDocument();
    // No account → useHistory is parked, no fetch.
    expect(historySpy).not.toHaveBeenCalled();
  });
});
