/**
 * Info-load failure must surface a visible error — never a silent network
 * assumption (the regression this migration removes).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor } from '@testing-library/react';
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
  USERNAME_CLAIM: true,
  MULTI_ASSET: false,
}));

vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

const ALICE = {
  address: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  numPubkeys: 0,
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
  username: 'alice',
};

beforeEach(() => {
  useNetworkStore.setState({
    apiUrl: 'https://test.api',
    network: '',
    usernameDomain: '',
    features: [],
    infoError: null,
    infoLoaded: false,
  });
  useWalletStore.setState({
    account: ALICE,
    balance: 0,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    error: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WalletScreen — info error is visible', () => {
  it('shows a network-info error when GET /v1/info fails (no silent fallback)', async () => {
    vi.spyOn(api, 'info').mockRejectedValue(new Error('ECONNREFUSED'));
    vi.spyOn(api, 'getHistory').mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(api, 'walletBalance').mockResolvedValue({ balance: 0, num_sends: 0 });

    const { findByTestId } = render(<WalletScreen />);

    const el = await findByTestId('network-info-error');
    expect(el.textContent).toMatch(/ECONNREFUSED|failed|info/i);

    await waitFor(() => {
      expect(useNetworkStore.getState().infoLoaded).toBe(true);
      expect(useNetworkStore.getState().infoError).toBeTruthy();
      // Network must stay empty — no local assumption.
      expect(useNetworkStore.getState().network).toBe('');
    });
  });

  it('would stay green without the fix only if catch swallowed the error — proves the assertion is real', async () => {
    // If info() failed and applyInfoFailure were never called, infoError would
    // remain null. This test documents that the screen *must* write the error.
    const applySpy = vi.spyOn(useNetworkStore.getState(), 'applyInfoFailure');
    // Re-bind store method: zustand actions are on the store object.
    const fail = vi.fn();
    useNetworkStore.setState({ applyInfoFailure: fail });

    vi.spyOn(api, 'info').mockRejectedValue(new Error('timeout'));
    vi.spyOn(api, 'getHistory').mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(api, 'walletBalance').mockResolvedValue({ balance: 0, num_sends: 0 });

    render(<WalletScreen />);

    await waitFor(() => {
      expect(fail).toHaveBeenCalled();
    });
    expect(applySpy).toBeDefined();
  });
});
