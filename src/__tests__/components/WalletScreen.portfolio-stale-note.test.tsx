/**
 * WalletScreen's hook-interface branch for a retained, stale portfolio that
 * remains available. The concrete usePortfolio implementation currently
 * couples stale:true to available:false, but UsePortfolioResult permits this
 * state and WalletScreen must render it without blocking the retained list.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/__tests__/_helpers/intl';
import { WalletScreen } from '@/components/screens/WalletScreen';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { api } from '@/lib/api/client';

const HOOK_MOCKS = vi.hoisted(() => ({
  usePortfolio: vi.fn(),
  useHistory: vi.fn(),
}));

vi.mock('@/hooks/usePortfolio', () => ({
  usePortfolio: HOOK_MOCKS.usePortfolio,
}));

vi.mock('@/hooks/useHistory', () => ({
  useHistory: HOOK_MOCKS.useHistory,
}));

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

const ALICE = {
  address: 'a'.repeat(64),
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};

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
  HOOK_MOCKS.usePortfolio.mockReturnValue({
    assets: [
      {
        asset_id: 'c'.repeat(64),
        name: 'MyCoin',
        decimals: 0,
        balance: 10_000,
        num_sends: 0,
      },
    ],
    loaded: true,
    available: true,
    unavailableReason: null,
    error: null,
    stale: true,
  });
  HOOK_MOCKS.useHistory.mockReturnValue({
    items: [],
    loaded: true,
    available: true,
    error: null,
    stale: false,
  });
  vi.spyOn(api, 'info').mockResolvedValue({
    network: 'regtest',
    features: ['wallet'],
    protocol_version: 'v1',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  HOOK_MOCKS.usePortfolio.mockReset();
  HOOK_MOCKS.useHistory.mockReset();
});

describe('WalletScreen — portfolio hook interface', () => {
  it('renders a stale note with a retained available portfolio', () => {
    render(<WalletScreen />);

    expect(screen.getByTestId('portfolio-stale-note')).toBeInTheDocument();
    expect(screen.getByTestId('asset-list')).toBeInTheDocument();
    expect(screen.queryByTestId('portfolio-error-banner')).not.toBeInTheDocument();
  });
});
