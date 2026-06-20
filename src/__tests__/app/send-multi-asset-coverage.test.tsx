/**
 * Multi-asset surface handler coverage for `src/app/send/page.tsx`
 * (`multi_asset:true`).
 *
 * The lifecycle/error/scan suites leave three multi-asset handlers
 * unexercised:
 *   - the asset `<select>` onChange (switching asset clears amount + error),
 *   - the `?asset=` deep-link branch of the picker-defaulting effect,
 *   - the success-screen Done button (`router.push('/')`).
 * This file drives all three.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
import SendPage from '@/app/send/page';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { useCapabilities } from '@/stores/capabilities';
import { api, type JobStatus, type OwnerBalanceResponse } from '@/lib/api/client';

// Mutable router + searchParams holder so individual tests can assert
// `push('/')` and vary the `?asset=` deep-link.
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  search: new URLSearchParams() as URLSearchParams,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  useSearchParams: () => nav.search,
}));

const ALICE = { address: 'a'.repeat(64), numPubkeys: 0, xpriv: 'xprv-alice' };
const ASSET1 = 'c'.repeat(64);
const ASSET2 = 'd'.repeat(64);

function portfolio(): OwnerBalanceResponse {
  return {
    address: ALICE.address,
    assets: [
      { asset_id: ASSET1, name: 'BigCoin', decimals: 8, balance: 100_000_000, num_sends: 0 },
      { asset_id: ASSET2, name: 'SmallCoin', decimals: 0, balance: 42, num_sends: 0 },
    ],
  };
}

beforeEach(() => {
  nav.push.mockClear();
  nav.replace.mockClear();
  nav.search = new URLSearchParams();
  // Runtime multi-asset capability ON → per-asset selector surface.
  useCapabilities.setState({
    capabilities: { address_list: false, username_claim: false, lnurl: false, multi_asset: true },
    loaded: true,
  });
  useNetworkStore.setState({
    apiUrl: 'https://test-api.zkcoins.app',
    usernameDomain: 'zkcoins.app',
  });
  useWalletStore.setState({
    account: ALICE,
    balance: 100_000_000,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: true,
    storedAddress: ALICE.address,
    storedAuthMethod: 'seed',
    error: null,
  });
  vi.spyOn(api, 'ownerBalances').mockResolvedValue(portfolio());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('SendPage (multi-asset) — asset selector', () => {
  it('switching the selected asset clears the typed amount', async () => {
    const user = userEvent.setup();
    render(<SendPage />);

    const select = (await screen.findByTestId('send-asset-select')) as HTMLSelectElement;
    // Default selection is the first held asset.
    await waitFor(() => expect(select.value).toBe(ASSET1));

    await user.type(screen.getByTestId('send-amount-input'), '0.5');
    expect(screen.getByTestId('send-amount-input')).toHaveValue('0.5');

    await user.selectOptions(select, ASSET2);
    expect(select.value).toBe(ASSET2);
    // onChange resets the amount so a value typed at one asset's decimals
    // can't carry over to another's.
    expect(screen.getByTestId('send-amount-input')).toHaveValue('');
    await waitFor(() => {
      expect(screen.getByTestId('send-available')).toHaveTextContent('42 SmallCoin');
    });
  });

  it('defaults the picker to the ?asset= deep-link when that asset is held', async () => {
    nav.search = new URLSearchParams(`asset=${ASSET2}`);
    render(<SendPage />);

    const select = (await screen.findByTestId('send-asset-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(ASSET2));
    expect(screen.getByTestId('send-available')).toHaveTextContent('42 SmallCoin');
  });
});

describe('SendPage (multi-asset) — success Done button', () => {
  it('routes home when Done is clicked on the success screen', async () => {
    vi.spyOn(api, 'send').mockResolvedValue({
      job_id: 'send-1',
      status: 'completed',
      phase: 'completed',
      result: { success: true, proof_id: 9 },
    } as JobStatus);

    const user = userEvent.setup();
    render(<SendPage />);
    await screen.findByTestId('send-asset-select');

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), '0.001');
    await user.click(screen.getByTestId('send-submit-btn'));
    await user.click(screen.getByTestId('send-confirm-btn'));

    await screen.findByTestId('send-success-heading');
    await user.click(screen.getByRole('button', { name: /fertig|done/i }));
    expect(nav.push).toHaveBeenCalledWith('/');
  });
});
