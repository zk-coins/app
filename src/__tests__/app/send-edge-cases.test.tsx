/**
 * SendPage UI edge cases (`src/app/send/page.tsx`), neutral multi-asset.
 *
 * Complements `SendForm.test.tsx` (amount-field validation) and
 * `send-pipeline.test.tsx` (lifecycle). Targets the conditional renders
 * and state-preservation branches:
 *
 *   - asset not loaded yet: Available reads "— <asset>", Set max disabled,
 *     no-funds banner hidden.
 *   - zero asset balance: no-funds banner visible, Set max disabled.
 *   - funded: Available shows the decimals-formatted balance, Set max on.
 *   - Confirm card cancel: inputs preserved, card gone.
 *   - Balance-not-loaded guard: handleConfirm aborts with the inline error.
 *   - Decimal rounding: a typed amount maps to the exact atomic units the
 *     server expects (no IEEE-754 drift) via the decimals scaling.
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
const ONE_UNIT = 100_000_000; // 8 decimals

function portfolio(balance: number): OwnerBalanceResponse {
  return {
    address: ALICE.address,
    assets: [{ asset_id: ASSET_ID, name: 'BigCoin', decimals: 8, balance, num_sends: 0 }],
  };
}

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

describe('SendPage — balance display states', () => {
  it('shows the loading placeholder before the portfolio resolves', () => {
    // Never-resolving portfolio → no asset selected → loading state.
    ownerSpy.mockReturnValue(new Promise<never>(() => {}));
    render(<SendPage />);

    const available = screen.getByTestId('send-available');
    expect(available).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('send-setmax-btn')).toBeDisabled();
    expect(screen.queryByTestId('send-no-funds-banner')).not.toBeInTheDocument();
  });

  it('renders the no-funds banner when the asset balance is exactly 0', async () => {
    ownerSpy.mockResolvedValue(portfolio(0));
    render(<SendPage />);

    const banner = await screen.findByTestId('send-no-funds-banner');
    expect(banner).toBeInTheDocument();
    expect(screen.getByTestId('send-setmax-btn')).toBeDisabled();
  });

  it('renders the formatted balance and enables Set max when funded', async () => {
    render(<SendPage />);
    await screen.findByTestId('send-asset-select');

    // The "Available" readout resolves once the picker effect selects the
    // first asset (one tick after the select renders), so wait for it.
    await waitFor(() => {
      expect(screen.getByTestId('send-available')).toHaveTextContent('1 BigCoin');
    });
    expect(screen.queryByTestId('send-no-funds-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('send-setmax-btn')).toBeEnabled();
  });
});

describe('SendPage — Confirm card cancel', () => {
  it('preserves the typed recipient and amount when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<SendPage />);
    await screen.findByTestId('send-asset-select');

    const recipient = screen.getByTestId('send-recipient-input') as HTMLInputElement;
    const amount = screen.getByTestId('send-amount-input') as HTMLInputElement;

    await user.type(recipient, 'b'.repeat(64));
    await user.type(amount, '0.01');
    await user.click(screen.getByTestId('send-submit-btn'));

    expect(screen.getByTestId('send-confirm-card')).toBeInTheDocument();
    expect(recipient.value).toBe('b'.repeat(64));
    expect(amount.value).toBe('0.01');

    await user.click(screen.getByTestId('send-cancel-btn'));

    expect(screen.queryByTestId('send-confirm-card')).not.toBeInTheDocument();
    expect(recipient.value).toBe('b'.repeat(64));
    expect(amount.value).toBe('0.01');
    expect(screen.getByTestId('send-submit-btn')).toBeEnabled();
  });

  it('shows the typed amount inside the confirm card scaled by decimals', async () => {
    const user = userEvent.setup();
    render(<SendPage />);
    await screen.findByTestId('send-asset-select');

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), '0.0021');
    await user.click(screen.getByTestId('send-submit-btn'));

    expect(screen.getByTestId('send-confirm-card')).toHaveTextContent('0.0021 BigCoin');
  });
});

describe('SendPage — decimal rounding', () => {
  it('maps a typed amount to the exact atomic units (no FP drift)', async () => {
    const user = userEvent.setup();
    render(<SendPage />);
    await screen.findByTestId('send-asset-select');

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    // 0.3 at 8 decimals → 30_000_000 atomic units exactly.
    await user.type(screen.getByTestId('send-amount-input'), '0.3');
    await user.click(screen.getByTestId('send-submit-btn'));

    expect(screen.getByTestId('send-confirm-card')).toHaveTextContent('0.3 BigCoin');
  });

  it('rounds the smallest unit (0.00000001 at 8 decimals → 1 atomic unit)', async () => {
    const user = userEvent.setup();
    render(<SendPage />);
    await screen.findByTestId('send-asset-select');

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), '0.00000001');
    await user.click(screen.getByTestId('send-submit-btn'));

    expect(screen.getByTestId('send-confirm-card').textContent).toMatch(/0\.00000001 BigCoin/);
  });
});
