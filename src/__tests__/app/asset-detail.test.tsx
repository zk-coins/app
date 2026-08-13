/**
 * AssetDetailPage (`src/app/asset/[id]/page.tsx`).
 *
 * Covers: the found-asset body (balance, id, decimals, send-counter), the
 * not-found state once the portfolio loads without the asset, the
 * per-wallet history note, and the unknown-name fallback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/__tests__/_helpers/intl';
import AssetDetailPage from '@/app/asset/[id]/page';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { ApiError, api, type OwnerBalanceResponse } from '@/lib/api/client';

const ASSET_ID = 'c'.repeat(64);
let mockParamId = ASSET_ID;
const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: mockParamId }),
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  // `notFound` stub kept for next/navigation module-surface completeness; the
  // route is default-active now and no longer guards with it.
  notFound: vi.fn(),
}));

// MULTI_ASSET is the runtime node capability; ON here so the per-asset detail
// route renders instead of redirecting home.
const FEATURES_STATE = vi.hoisted(() => ({
  APPS_DIRECTORY: false,
  PASSKEY: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
  USERNAME_CLAIM: false,
  MULTI_ASSET: true,
  loaded: true,
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

function portfolio(assets: OwnerBalanceResponse['assets']): OwnerBalanceResponse {
  return { address: ALICE.address, assets };
}

let ownerSpy: ReturnType<typeof vi.spyOn>;
let historySpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockParamId = ASSET_ID;
  routerReplace.mockClear();
  FEATURES_STATE.MULTI_ASSET = true;
  FEATURES_STATE.loaded = true;
  useNetworkStore.setState({ infoError: null });
  useWalletStore.setState({
    account: ALICE,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: true,
    storedAddress: ALICE.address,
    storedAuthMethod: 'seed',
    error: null,
  });
  infoSpy = vi.spyOn(api, 'info').mockResolvedValue({
    network: 'regtest',
    protocol_version: 'v1',
    features: ['wallet'],
    capabilities: {
      address_list: false,
      username_claim: false,
      lnurl: false,
      multi_asset: true,
    },
  });
  ownerSpy = vi.spyOn(api, 'ownerBalances');
  historySpy = vi
    .spyOn(api, 'getHistory')
    .mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
});

afterEach(() => {
  ownerSpy.mockRestore();
  historySpy.mockRestore();
  infoSpy.mockRestore();
});

describe('AssetDetailPage', () => {
  it('renders the asset body with balance, id, decimals, send counter', async () => {
    ownerSpy.mockResolvedValue(
      portfolio([
        { asset_id: ASSET_ID, name: 'MyCoin', decimals: 2, balance: 12_345, num_sends: 3 },
      ]),
    );

    render(<AssetDetailPage />);

    expect(await screen.findByTestId('asset-detail-body')).toBeInTheDocument();
    expect(screen.getByTestId('asset-detail-name')).toHaveTextContent('MyCoin');
    // 12_345 at 2 decimals → 123.45
    expect(screen.getByTestId('asset-detail-balance')).toHaveTextContent('123.45');
    expect(screen.getByTestId('asset-row-decimals')).toHaveTextContent('2');
    expect(screen.getByTestId('asset-row-sends')).toHaveTextContent('3');
    // The per-wallet history note is always shown on the detail.
    expect(screen.getByTestId('asset-history-note')).toBeInTheDocument();
  });

  it('falls back to a placeholder name for an asset without genesis metadata', async () => {
    ownerSpy.mockResolvedValue(portfolio([{ asset_id: ASSET_ID, balance: 5, num_sends: 0 }]));

    render(<AssetDetailPage />);
    expect(await screen.findByTestId('asset-detail-name')).toHaveTextContent('Unbekanntes Asset');
  });

  it('shows the not-found state only after a successful portfolio read without the asset', async () => {
    ownerSpy.mockResolvedValue(portfolio([]));

    render(<AssetDetailPage />);
    expect(await screen.findByTestId('asset-detail-missing')).toBeInTheDocument();
  });

  it('shows unavailable (not missing) when portfolio is 501', async () => {
    ownerSpy.mockRejectedValue(
      new ApiError(
        501,
        'portfolio not available in this build — AccountState balances decode is not wired yet',
      ),
    );

    render(<AssetDetailPage />);
    expect(await screen.findByTestId('asset-detail-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('asset-detail-missing')).not.toBeInTheDocument();
  });

  it('uses translated unavailable copy when a failed portfolio read has an empty message', async () => {
    ownerSpy.mockRejectedValue(new Error(''));

    render(<AssetDetailPage />);
    expect(await screen.findByTestId('asset-detail-unavailable')).toHaveTextContent(
      'Portfolio-Reads sind in diesem Build nicht verfügbar',
    );
  });

  it('shows error (not missing) when portfolio read fails for other reasons', async () => {
    ownerSpy.mockRejectedValue(new Error('network down'));

    render(<AssetDetailPage />);
    expect(await screen.findByTestId('asset-detail-error')).toBeInTheDocument();
    expect(screen.queryByTestId('asset-detail-missing')).not.toBeInTheDocument();
  });

  it('renders the owner history rows under the note', async () => {
    ownerSpy.mockResolvedValue(
      portfolio([{ asset_id: ASSET_ID, name: 'MyCoin', decimals: 0, balance: 100, num_sends: 0 }]),
    );
    historySpy.mockResolvedValue({
      items: [
        {
          id: 1,
          kind: 'mint',
          amount: 100,
          status: 'pending',
          created_at: 1_780_000_000,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(<AssetDetailPage />);
    expect(await screen.findByTestId('asset-tx-row')).toBeInTheDocument();
  });

  it('renders send, receive, and amount-less owner-history rows', async () => {
    ownerSpy.mockResolvedValue(
      portfolio([{ asset_id: ASSET_ID, name: 'MyCoin', decimals: 0, balance: 100, num_sends: 1 }]),
    );
    historySpy.mockResolvedValue({
      items: [
        { id: 1, kind: 'send', amount: 5, created_at: 1_780_000_000 },
        { id: 2, kind: 'receive', amount: 5, created_at: 1_780_000_001 },
        { id: 3, kind: 'mint', amount: undefined, created_at: 1_780_000_002 },
      ],
      total: 3,
      limit: 50,
      offset: 0,
    });
    render(<AssetDetailPage />);
    const rows = await screen.findAllByTestId('asset-tx-row');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveTextContent('—');
  });

  it('maps unknown history kinds to neutral unknown label, not receive', async () => {
    ownerSpy.mockResolvedValue(
      portfolio([{ asset_id: ASSET_ID, name: 'MyCoin', decimals: 0, balance: 100, num_sends: 0 }]),
    );
    historySpy.mockResolvedValue({
      items: [{ id: 1, kind: 'burn', amount: 7, created_at: 1_780_000_000 }],
      total: 1,
      limit: 50,
      offset: 0,
    });
    render(<AssetDetailPage />);
    const row = await screen.findByTestId('asset-tx-row');
    expect(row).toHaveTextContent('Unbekannt');
    expect(row).not.toHaveTextContent('Empfangen');
    const iconWrap = row.querySelector('div.flex.h-9');
    expect(iconWrap).not.toBeNull();
    expect(iconWrap?.className).toContain('bg-bitcoin/10');
    expect(iconWrap?.className).toContain('text-bitcoin');
    expect(iconWrap?.className).not.toContain('bg-line');
  });
  it('shows no terminal state while the first portfolio request is pending', () => {
    ownerSpy.mockReturnValue(new Promise<never>(() => {}));
    render(<AssetDetailPage />);
    expect(screen.queryByTestId('asset-detail-body')).toBeNull();
    expect(screen.queryByTestId('asset-detail-missing')).toBeNull();
  });

  it('redirects when runtime multi-asset support is absent', () => {
    FEATURES_STATE.MULTI_ASSET = false;
    FEATURES_STATE.loaded = true;
    ownerSpy.mockResolvedValue(portfolio([]));
    render(<AssetDetailPage />);
    expect(routerReplace).toHaveBeenCalledWith('/');
  });

  it('does not redirect when multi-asset is fail-closed after infoError', () => {
    FEATURES_STATE.MULTI_ASSET = false;
    FEATURES_STATE.loaded = true;
    useNetworkStore.setState({ infoError: 'GET /v1/info failed' });
    ownerSpy.mockResolvedValue(portfolio([]));
    render(<AssetDetailPage />);
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('does not redirect when capabilities have not loaded yet', () => {
    FEATURES_STATE.MULTI_ASSET = false;
    FEATURES_STATE.loaded = false;
    ownerSpy.mockResolvedValue(portfolio([]));
    render(<AssetDetailPage />);
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('parks account-scoped reads when no wallet is present', () => {
    useWalletStore.setState({ account: null });
    render(<AssetDetailPage />);
    expect(ownerSpy).not.toHaveBeenCalled();
    expect(historySpy).not.toHaveBeenCalled();
  });

  it('parks history when signing material is incomplete while portfolio still loads', async () => {
    useWalletStore.setState({ account: { ...ALICE, nkCommit: '' } });
    ownerSpy.mockResolvedValue(portfolio([]));
    render(<AssetDetailPage />);
    expect(await screen.findByTestId('asset-detail-missing')).toBeInTheDocument();
    expect(historySpy).not.toHaveBeenCalled();
  });
});
