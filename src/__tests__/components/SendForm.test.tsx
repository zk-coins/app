/**
 * Component test — amount-field validation in `SendPage`
 * (`src/app/send/page.tsx`), neutral multi-asset model.
 *
 * Drives the funded-wallet branch (Alice holding one asset with a known
 * balance) and asserts the submit-button disabled state + inline error
 * rendering. Error copy is German (default locale). The send pipeline
 * itself is covered in send-pipeline.test.tsx + spec 07.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
import SendPage from '@/app/send/page';
import { useWalletStore } from '@/stores/wallet';
import { useCapabilities } from '@/stores/capabilities';
import { api, type OwnerBalanceResponse } from '@/lib/api/client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const ALICE = {
  address: 'a'.repeat(64),
  numPubkeys: 0,
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};
const ASSET_ID = 'c'.repeat(64);

// 8-decimal asset so a typed "1" maps to 100_000_000 atomic units, like BTC.
function portfolio(balance: number): OwnerBalanceResponse {
  return {
    address: ALICE.address,
    assets: [{ asset_id: ASSET_ID, name: 'BigCoin', decimals: 8, balance, num_sends: 0 }],
  };
}

const ONE_UNIT = 100_000_000;

let ownerSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Runtime multi-asset capability ON so SendPage renders the per-asset
  // selector surface this suite drives.
  useCapabilities.setState({
    capabilities: { address_list: false, username_claim: false, lnurl: false, multi_asset: true },
    loaded: true,
  });
  useWalletStore.setState({
    account: ALICE,
    balance: ONE_UNIT,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: true,
    storedAddress: ALICE.address,
    storedAuthMethod: 'seed',
    error: null,
  });
  ownerSpy = vi.spyOn(api, 'ownerBalances').mockResolvedValue(portfolio(ONE_UNIT));
});

afterEach(() => {
  ownerSpy.mockRestore();
});

async function waitForAssetLoaded() {
  // The asset picker renders once the portfolio loads.
  await screen.findByTestId('send-asset-select');
}

describe('SendPage — amount field validation', () => {
  it('disables submit button while either field is empty', async () => {
    const user = userEvent.setup();
    render(<SendPage />);
    await waitForAssetLoaded();

    const submit = screen.getByTestId('send-submit-btn');
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId('send-amount-input'), '0.001');
    expect(submit).toBeEnabled();
  });

  it('renders an Invalid-amount error for unparseable text', async () => {
    const user = userEvent.setup();
    render(<SendPage />);
    await waitForAssetLoaded();

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), 'abc');
    await user.click(screen.getByTestId('send-submit-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent('Ungültiger Betrag');
  });

  it('renders an Insufficient-balance error when amount exceeds balance', async () => {
    const user = userEvent.setup();
    render(<SendPage />);
    await waitForAssetLoaded();

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    // Balance is 1 unit; ask for 2.
    await user.type(screen.getByTestId('send-amount-input'), '2');
    await user.click(screen.getByTestId('send-submit-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent('Nicht genug Guthaben');
  });

  it('Set-max button fills the amount field with the formatted balance', async () => {
    const user = userEvent.setup();
    render(<SendPage />);
    await waitForAssetLoaded();

    const amountInput = screen.getByTestId('send-amount-input') as HTMLInputElement;
    expect(amountInput.value).toBe('');

    await user.click(screen.getByTestId('send-setmax-btn'));
    expect(amountInput.value).not.toBe('');
    expect(parseFloat(amountInput.value)).toBeCloseTo(1, 8);
  });

  it('Set-max button stays disabled when balance is zero', async () => {
    ownerSpy.mockResolvedValue(portfolio(0));
    render(<SendPage />);
    await waitForAssetLoaded();

    expect(screen.getByTestId('send-setmax-btn')).toBeDisabled();
  });

  it('clears any existing error when the amount validates successfully', async () => {
    const user = userEvent.setup();
    render(<SendPage />);
    await waitForAssetLoaded();

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), 'abc');
    await user.click(screen.getByTestId('send-submit-btn'));
    expect(await screen.findByTestId('send-error')).toBeInTheDocument();

    await user.clear(screen.getByTestId('send-amount-input'));
    await user.type(screen.getByTestId('send-amount-input'), '0.001');
    await user.click(screen.getByTestId('send-submit-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('send-error')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('send-confirm-card')).toBeInTheDocument();
  });

  it('renders the empty-asset notice when the wallet holds nothing', async () => {
    ownerSpy.mockResolvedValue({ address: ALICE.address, assets: [] });
    render(<SendPage />);
    expect(await screen.findByTestId('send-asset-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('send-asset-select')).not.toBeInTheDocument();
  });
});
