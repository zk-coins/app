/**
 * Single-asset surface of WalletScreen when MULTI_ASSET is false.
 *
 * Balance reads are not available in this build — the hero must show an
 * honest "not available" state, never a fabricated 0 / empty wallet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
import { WalletScreen } from '@/components/screens/WalletScreen';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { ApiError, api } from '@/lib/api/client';

const FEATURES_STATE = vi.hoisted(() => ({
  APPS_DIRECTORY: false,
  PASSKEY: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
  USERNAME_CLAIM: false,
  MULTI_ASSET: false,
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

let infoSpy: ReturnType<typeof vi.spyOn>;
let historySpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  Object.assign(FEATURES_STATE, {
    USERNAME_CLAIM: false,
    MULTI_ASSET: false,
    APPS_DIRECTORY: false,
  });
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
  infoSpy = vi.spyOn(api, 'info').mockResolvedValue({
    network: 'regtest',
    features: [],
    protocol_version: 'v1',
    username_domain: 'local.zkcoins.test',
  });
  vi.spyOn(api, 'walletBalance').mockRejectedValue(
    new ApiError(501, 'wallet balance not available in this build'),
  );
  historySpy = vi
    .spyOn(api, 'getHistory')
    .mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WalletScreen — single-asset balance unavailable', () => {
  it('shows the honest not-available hero, not a $0 empty wallet', async () => {
    const { findByTestId, queryByTestId } = render(<WalletScreen />);
    const usd = await findByTestId('balance-amount-usd');
    expect(usd).toHaveAttribute('data-unavailable', 'true');
    expect(await findByTestId('balance-unavailable-banner')).toBeInTheDocument();
    // Empty-wallet faucet path must NOT appear (that implies balance === 0 truth).
    expect(queryByTestId('faucet-btn')).toBeNull();
    expect(queryByTestId('wallet-empty-banner')).toBeNull();
    expect(queryByTestId('asset-list')).toBeNull();
    expect(queryByTestId('create-coin-btn')).toBeNull();
    void infoSpy;
    void historySpy;
  });

  it('hides the not-available text when the eye toggle is pressed', async () => {
    const user = userEvent.setup();
    const { findByTestId } = render(<WalletScreen />);
    const toggle = await findByTestId('balance-toggle-btn');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('data-hidden', 'true');
  });

  it('hides name claim and shows the unavailable note', async () => {
    const { findByTestId, queryByTestId } = render(<WalletScreen />);
    expect(await findByTestId('name-claim-unavailable')).toBeInTheDocument();
    expect(queryByTestId('username-claim-btn')).toBeNull();
    expect(queryByTestId('name-setup-input')).toBeNull();
  });
});
