/**
 * Transaction-list rendering in `WalletScreen` from server `/v1/history`
 * truth (issue #175). Complements `WalletScreen.polling.test.tsx`
 * (portfolio cadence) by exercising the list/empty-state gating and the
 * per-row mapping of the node's `HistoryItem` shape (kind → label,
 * created_at as Unix-seconds or ISO). Labels are German (the default locale).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/__tests__/_helpers/intl';
import { WalletScreen } from '@/components/screens/WalletScreen';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { api, type HistoryItem, type OwnerBalanceResponse } from '@/lib/api/client';

const FEATURES_STATE = vi.hoisted(() => ({
  APPS_DIRECTORY: false,
  PASSKEY: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
  USERNAME_CLAIM: false,
  // Runtime multi-asset capability ON for the multi-asset surface this suite covers.
  MULTI_ASSET: true,
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

function row(over: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: 1,
    kind: 'mint',
    amount: 10_000,
    status: 'pending',
    created_at: 1_780_000_000,
    ...over,
  };
}

const FUNDED: OwnerBalanceResponse = {
  address: ALICE.address,
  assets: [
    { asset_id: 'c'.repeat(64), name: 'MyCoin', decimals: 0, balance: 10_000, num_sends: 0 },
  ],
};

let historySpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useNetworkStore.setState({
    apiUrl: 'https://test.api',
    network: 'regtest',
    infoError: null,
    infoLoaded: true,
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
  vi.spyOn(api, 'info').mockResolvedValue({
    network: 'regtest',
    features: ['wallet'],
    protocol_version: 'v1',
  });
  vi.spyOn(api, 'ownerBalances').mockResolvedValue(FUNDED);
  historySpy = vi.spyOn(api, 'getHistory');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('WalletScreen — transaction list from server history', () => {
  it('renders the mint row for a funded wallet without any local action', async () => {
    historySpy.mockResolvedValue({ items: [row()], total: 1, limit: 50, offset: 0 });

    render(<WalletScreen />);

    expect(await screen.findByText('Erstellt')).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Transaktionen')).not.toBeInTheDocument();
    expect(screen.getByTestId('tx-row-amount')).toBeInTheDocument();
  });

  it('maps kind to label (mint, receive, send)', async () => {
    historySpy.mockResolvedValue({
      items: [
        row({ id: 1, kind: 'mint', amount: 10_000 }),
        row({ id: 2, kind: 'receive', amount: 25_000 }),
        row({ id: 3, kind: 'send', amount: 5_000 }),
      ],
      total: 3,
      limit: 50,
      offset: 0,
    });

    render(<WalletScreen />);

    // Scope to the tx rows: "Empfangen" / "Gesendet" also appear on the
    // Receive / Send action buttons, so assert via the row containers.
    const rows = await screen.findAllByTestId('tx-row');
    const labels = rows.map((r) => r.textContent ?? '');
    expect(labels.some((l) => l.includes('Erstellt'))).toBe(true);
    expect(labels.some((l) => l.includes('Empfangen'))).toBe(true);
    expect(labels.some((l) => l.includes('Gesendet'))).toBe(true);

    const amounts = screen.getAllByTestId('tx-row-amount').map((n) => n.textContent ?? '');
    // The send row is the only debit → the only one with a leading minus.
    expect(amounts.filter((t) => t.trim().startsWith('-'))).toHaveLength(1);
  });

  it('renders the row time from a Unix-seconds timestamp (not raw ms)', async () => {
    historySpy.mockResolvedValue({ items: [row()], total: 1, limit: 50, offset: 0 });

    render(<WalletScreen />);

    const time = await screen.findByTestId('tx-row-time');
    expect(time.textContent).toMatch(/^\d{1,2}:\d{2}/);
    expect(time.textContent).not.toContain('Invalid');
  });

  it('shows the empty state once history has loaded and is genuinely empty', async () => {
    historySpy.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });

    render(<WalletScreen />);

    expect(await screen.findByText('Noch keine Transaktionen')).toBeInTheDocument();
  });

  it('holds the empty state back while the first history fetch is in flight', async () => {
    historySpy.mockReturnValue(new Promise<never>(() => {}));

    render(<WalletScreen />);

    await waitFor(() => expect(screen.getByTestId('create-coin-btn')).toBeInTheDocument());
    expect(screen.queryByText('Noch keine Transaktionen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tx-row-amount')).not.toBeInTheDocument();
  });

  it('prompts to create a wallet when there is no account', async () => {
    useWalletStore.setState({ account: null });
    historySpy.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });

    render(<WalletScreen />);

    expect(await screen.findByText('Erstelle ein Wallet, um zu starten.')).toBeInTheDocument();
    expect(historySpy).not.toHaveBeenCalled();
  });
});
