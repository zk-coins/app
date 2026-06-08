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
import { api, type OwnerBalanceResponse } from '@/lib/api/client';

const ASSET_ID = 'c'.repeat(64);
let mockParamId = ASSET_ID;

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: mockParamId }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  // The page guards with `!FEATURES.MULTI_ASSET) notFound()`; the features
  // mock below forces the flag ON, so this is never invoked.
  notFound: vi.fn(),
}));

// MULTI_ASSET ON so the per-asset detail route renders instead of
// 404-ing / redirecting home.
const FEATURES_STATE = vi.hoisted(() => ({
  APPS_DIRECTORY: false,
  PASSKEY: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
  USERNAME_CLAIM: false,
  MULTI_ASSET: true,
}));
vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

const ALICE = { address: 'a'.repeat(64), numPubkeys: 0, xpriv: 'xprv-alice' };

function portfolio(assets: OwnerBalanceResponse['assets']): OwnerBalanceResponse {
  return { address: ALICE.address, assets };
}

let ownerSpy: ReturnType<typeof vi.spyOn>;
let historySpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockParamId = ASSET_ID;
  useWalletStore.setState({
    account: ALICE,
    balance: null,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: true,
    storedAddress: ALICE.address,
    storedAuthMethod: 'seed',
    error: null,
  });
  ownerSpy = vi.spyOn(api, 'ownerBalances');
  historySpy = vi
    .spyOn(api, 'getHistory')
    .mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
});

afterEach(() => {
  ownerSpy.mockRestore();
  historySpy.mockRestore();
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

  it('shows the not-found state once the portfolio loads without the asset', async () => {
    ownerSpy.mockResolvedValue(portfolio([]));

    render(<AssetDetailPage />);
    expect(await screen.findByTestId('asset-detail-missing')).toBeInTheDocument();
  });

  it('renders the owner history rows under the note', async () => {
    ownerSpy.mockResolvedValue(
      portfolio([{ asset_id: ASSET_ID, name: 'MyCoin', decimals: 0, balance: 100, num_sends: 0 }]),
    );
    historySpy.mockResolvedValue({
      items: [
        {
          id: 1,
          txid: null,
          timestamp: 1_780_000_000,
          direction: 'mint',
          amount: 100,
          counterparty: null,
          status: 'pending',
          block_height: null,
          memo: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(<AssetDetailPage />);
    expect(await screen.findByTestId('asset-tx-row')).toBeInTheDocument();
  });
});
