/**
 * Transaction-detail page (`src/app/tx/[id]/page.tsx`).
 *
 * Drives the real page + the real `useTransaction` hook with a mocked
 * `next/navigation` route param and a mocked `api.getTransaction`, so the
 * id-parsing, account scoping, the loading / not-found / error / body
 * states, and the per-field rendering are all exercised end-to-end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@/__tests__/_helpers/intl';
import TransactionDetailPage from '@/app/tx/[id]/page';
import { ApiError, api, type TxDetail } from '@/lib/api/client';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';

const route = vi.hoisted(() => ({ id: '7' as string }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: route.id }),
}));

const ALICE = {
  address: 'a'.repeat(64),
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};

const MINT: TxDetail = {
  id: 7,
  kind: 'mint',
  address: 'a'.repeat(64),
  created_at: 1_780_000_000,
  amount: 10_000,
  status: 'pending',
  balance_after: 10_000,
  num_sends_after: 0,
  circuit_digest: 'cd'.repeat(32),
};

let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  route.id = '7';
  useNetworkStore.setState({ usernameDomain: 'dev.zkcoins.app' });
  useWalletStore.setState({
    account: ALICE,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    error: null,
  });
  spy = vi.spyOn(api, 'getTransaction');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TransactionDetailPage', () => {
  it('shows the loading state while the fetch is in flight', () => {
    spy.mockReturnValue(new Promise<never>(() => {}));
    render(<TransactionDetailPage />);
    expect(screen.getByTestId('tx-detail-loading')).toBeInTheDocument();
  });

  it('renders a funded mint detail with the decoded snapshot fields', async () => {
    spy.mockResolvedValue(MINT);
    render(<TransactionDetailPage />);

    expect(await screen.findByTestId('tx-detail-body')).toBeInTheDocument();
    expect(screen.getByTestId('tx-detail-label')).toHaveTextContent('Erstellt');
    expect(screen.getByTestId('tx-detail-status')).toHaveTextContent('ausstehend');
    expect(screen.getByTestId('tx-detail-v-balance-after')).toHaveTextContent('BTC');
    // First-row mint: no prior balance, no commitment key, not broadcast.
    expect(screen.getByTestId('tx-detail-v-balance-before')).toHaveTextContent('—');
    expect(screen.getByTestId('tx-detail-v-num-sends')).toHaveTextContent('0');
    expect(screen.getByTestId('tx-detail-txid')).toHaveTextContent('Not yet broadcast');
    expect(screen.getByTestId('tx-detail-counterparty')).toHaveTextContent('Private');
    expect(screen.getByTestId('tx-detail-source')).toHaveTextContent('Your node');
    // Pending records stay explicitly unconfirmed.
    expect(screen.getByTestId('tx-detail-confirmation')).toHaveTextContent(
      'Wartet auf Bestätigung',
    );
    expect(spy).toHaveBeenCalledWith('7', {
      address: ALICE.address,
      mnemonic: ALICE.mnemonic,
      nkCommit: ALICE.nkCommit,
    });
  });

  it('renders a confirmed send: signed amount, confirmation state, raw txid', async () => {
    spy.mockResolvedValue({
      ...MINT,
      kind: 'send',
      status: 'confirmed',
      amount: 6_000,
      balance_after: 4_000,
      balance_before: 10_000,
      num_sends_after: 1,
      txid: 'ab'.repeat(32),
      block_height: 900_001,
      commitment_public_key: '02'.padEnd(66, 'a'),
      commit_output_value: 546,
    });
    render(<TransactionDetailPage />);

    expect(await screen.findByTestId('tx-detail-label')).toHaveTextContent('Gesendet');
    // Debit → Unicode-minus signed amount.
    expect(screen.getByTestId('tx-detail-v-amount')).toHaveTextContent('−');
    expect(screen.getByTestId('tx-detail-confirmation')).toHaveTextContent('Bestätigt');
    expect(screen.getByTestId('tx-detail-v-txid')).toBeInTheDocument();
    // No explorer env in unit tests → plain txid span, no outbound link.
    expect(screen.queryByTestId('tx-detail-explorer-link')).not.toBeInTheDocument();
    expect(screen.getByTestId('tx-detail-v-block-height')).toHaveTextContent('900001');
  });

  it('renders a receive detail label', async () => {
    spy.mockResolvedValue({ ...MINT, kind: 'receive' });
    render(<TransactionDetailPage />);
    expect(await screen.findByTestId('tx-detail-label')).toHaveTextContent('Empfangen');
  });

  it('maps unknown kinds to Unknown with debit chrome, not receive credit', async () => {
    spy.mockResolvedValue({ ...MINT, kind: 'burn', amount: 10_000 });
    render(<TransactionDetailPage />);

    expect(await screen.findByTestId('tx-detail-label')).toHaveTextContent('Unbekannt');
    expect(screen.getByTestId('tx-detail-direction')).toHaveTextContent('Unbekannt');
    const amount = screen.getByTestId('tx-detail-v-amount');
    expect(amount.textContent).not.toMatch(/^\+/);
    expect(amount).toHaveTextContent('−');
    const iconCircle = screen.getByTestId('tx-detail-body').querySelector('div.flex.h-14');
    expect(iconCircle).not.toBeNull();
    expect(iconCircle?.className).toContain('bg-bitcoin/10');
    expect(iconCircle?.className).not.toContain('bg-line');
  });

  it('renders a sparse record with every unavailable-field fallback and invalid date', async () => {
    spy.mockResolvedValue({
      id: 'sparse',
      kind: 'receive',
      created_at: 'invalid-date',
      status: 'mystery',
    } as TxDetail);
    render(<TransactionDetailPage />);
    expect(await screen.findByTestId('tx-detail-v-amount')).toHaveTextContent('—');
    expect(screen.getByTestId('tx-detail-v-time')).toHaveTextContent('—');
    expect(screen.getByTestId('tx-detail-account')).toHaveTextContent('—');
    expect(screen.getByTestId('tx-detail-v-amount-full')).toHaveTextContent('—');
    expect(screen.getByTestId('tx-detail-v-balance-after')).toHaveTextContent('—');
    expect(screen.getByTestId('tx-detail-v-num-sends')).toHaveTextContent('—');
    expect(screen.getByTestId('tx-detail-v-block-height')).toHaveTextContent('—');
    expect(screen.getByTestId('tx-detail-v-commit-value')).toHaveTextContent('—');
    expect(screen.getByTestId('tx-detail-memo')).toHaveTextContent('—');
    expect(screen.getByTestId('tx-detail-status')).toHaveTextContent('unbekannt');
    expect(screen.getByTestId('tx-detail-confirmation')).toHaveTextContent('Status unbekannt');
  });

  it('renders a detail without status as unknown', async () => {
    const { status: _status, ...withoutStatus } = MINT;
    void _status;
    spy.mockResolvedValue(withoutStatus as TxDetail);
    render(<TransactionDetailPage />);
    expect(await screen.findByTestId('tx-detail-status')).toHaveTextContent('unbekannt');
    expect(screen.getByTestId('tx-detail-confirmation')).toHaveTextContent('Status unbekannt');
  });

  it.each(['failed', 'cancelled'])('renders %s as not confirmed', async (status) => {
    spy.mockResolvedValue({ ...MINT, status });
    render(<TransactionDetailPage />);
    expect(await screen.findByTestId('tx-detail-confirmation')).toHaveTextContent(
      'Nicht bestätigt',
    );
  });

  it('treats completed as confirmed and renders supplied privacy fields', async () => {
    spy.mockResolvedValue({
      ...MINT,
      status: 'completed',
      address: 'alice',
      counterparty: 'bob',
      memo: 'invoice 7',
    });
    render(<TransactionDetailPage />);
    expect(await screen.findByTestId('tx-detail-confirmation')).toHaveTextContent('Bestätigt');
    expect(screen.getByTestId('tx-detail-account')).toHaveTextContent('alice@dev.zkcoins.app');
    expect(screen.getByTestId('tx-detail-counterparty')).toHaveTextContent('bob');
    expect(screen.getByTestId('tx-detail-memo')).toHaveTextContent('invoice 7');
  });

  it('falls back to a truncated raw address when the username domain is unset', async () => {
    useNetworkStore.setState({ usernameDomain: '' });
    spy.mockResolvedValue(MINT);
    render(<TransactionDetailPage />);
    // toZkAddress('', …) returns '' → the account row shows the
    // truncated raw hex instead of the @domain chip.
    const account = await screen.findByTestId('tx-detail-account');
    expect(account).toHaveTextContent('aaaaaaaaaa...aaaaaaaa');
  });

  it('shows an em-dash when circuit digest is absent', async () => {
    const { circuit_digest: _omit, ...rest } = MINT;
    void _omit;
    spy.mockResolvedValue(rest);
    render(<TransactionDetailPage />);
    expect(await screen.findByTestId('tx-detail-v-circuit-digest')).toHaveTextContent('—');
  });

  it('shows not-found for an empty route id without fetching', async () => {
    route.id = '';
    render(<TransactionDetailPage />);
    expect(await screen.findByTestId('tx-detail-missing')).toHaveTextContent(
      'Transaktion nicht gefunden',
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a non-string route id without fetching', async () => {
    (route as { id: unknown }).id = 7;
    render(<TransactionDetailPage />);
    expect(await screen.findByTestId('tx-detail-missing')).toHaveTextContent(
      'Transaktion nicht gefunden',
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows wallet-unavailable when there is no unlocked account', async () => {
    useWalletStore.setState({ account: null });
    render(<TransactionDetailPage />);
    const surface = await screen.findByTestId('tx-detail-wallet-unavailable');
    expect(surface).toHaveTextContent('Wallet entsperren, um diese Transaktion zu sehen');
    expect(screen.queryByTestId('tx-detail-missing')).not.toBeInTheDocument();
    expect(screen.queryByText('Transaktion nicht gefunden')).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows wallet-unavailable when the account lacks mnemonic or nkCommit signing material', async () => {
    useWalletStore.setState({ account: { ...ALICE, mnemonic: '' } });
    render(<TransactionDetailPage />);
    const surface = await screen.findByTestId('tx-detail-wallet-unavailable');
    expect(surface).toHaveTextContent('Wallet entsperren, um diese Transaktion zu sehen');
    expect(screen.queryByTestId('tx-detail-missing')).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows wallet-unavailable when nkCommit is missing', async () => {
    useWalletStore.setState({ account: { ...ALICE, nkCommit: '' } });
    render(<TransactionDetailPage />);
    expect(await screen.findByTestId('tx-detail-wallet-unavailable')).toHaveTextContent(
      'Wallet entsperren, um diese Transaktion zu sehen',
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows not-found when the node 404s the row', async () => {
    spy.mockRejectedValue(
      new ApiError(404, 'transaction not found', undefined, 'transaction_not_found'),
    );
    render(<TransactionDetailPage />);
    expect(await screen.findByTestId('tx-detail-missing')).toHaveTextContent(
      'Transaktion nicht gefunden',
    );
  });

  it('shows generic error when 404 is account not_found, not tx-missing', async () => {
    spy.mockRejectedValue(new ApiError(404, 'Unknown account address', undefined, 'not_found'));
    render(<TransactionDetailPage />);
    expect(await screen.findByTestId('tx-detail-missing')).toHaveTextContent(
      'Transaktion konnte nicht geladen werden',
    );
    expect(screen.queryByText('Transaktion nicht gefunden')).not.toBeInTheDocument();
  });

  it('shows the generic error state on a non-404 failure', async () => {
    spy.mockRejectedValue(new ApiError(500, 'Database error'));
    render(<TransactionDetailPage />);
    expect(await screen.findByTestId('tx-detail-missing')).toHaveTextContent(
      'Transaktion konnte nicht geladen werden',
    );
  });
});

describe('TransactionDetailPage — explorer link', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('links the txid to the configured block explorer', async () => {
    vi.stubEnv('NEXT_PUBLIC_EXPLORER_URL', 'https://zkcoins.space/');
    vi.resetModules();
    const { default: FreshPage } = await import('@/app/tx/[id]/page');
    const freshApi = (await import('@/lib/api/client')).api;
    const store = (await import('@/stores/wallet')).useWalletStore;
    const net = (await import('@/stores/network')).useNetworkStore;
    net.setState({ usernameDomain: 'dev.zkcoins.app' });
    store.setState({
      account: ALICE,
      isLoading: false,
      isLocked: false,
      hasStoredWallet: false,
      storedAddress: null,
      storedAuthMethod: null,
      error: null,
    });
    vi.spyOn(freshApi, 'getTransaction').mockResolvedValue({
      ...MINT,
      kind: 'send',
      status: 'confirmed',
      txid: 'ab'.repeat(32),
    });

    render(<FreshPage />);
    const link = await screen.findByTestId('tx-detail-explorer-link');
    expect(link).toHaveAttribute('href', `https://zkcoins.space/tx/${'ab'.repeat(32)}`);
    expect(link).toHaveAttribute('target', '_blank');
  });
});
