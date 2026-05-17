/**
 * Component test — amount-field validation in `SendPage`
 * (`src/app/send/page.tsx`). Issue #68 W1.
 *
 * Drives the funded-wallet branch of the page (Alice with a known
 * non-zero balance) and asserts on the disabled-state of the submit
 * button plus the inline error rendering. The Send pipeline itself
 * (sign → /api/send → commit) is covered end-to-end by spec 07.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SendPage from '@/app/send/page';
import { useWalletStore } from '@/stores/wallet';

// Vitest hoists `vi.mock` above the imports, so SendPage's `useRouter()`
// already sees the stub when the module evaluates. SendPage uses
// `replace` (no-account redirect) and `push` (success → Done).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

// 1 BTC in sats — keeps math easy: setting amount='0.5' → 50_000_000 sats < balance.
const ONE_BTC_SATS = 100_000_000;
const ALICE = {
  address: 'a'.repeat(64),
  numPubkeys: 0,
  xpriv: 'xprv9s21ZrQH143K3GJpoapnV8SFfuZcECe',
};

beforeEach(() => {
  useWalletStore.setState({
    account: ALICE,
    balance: ONE_BTC_SATS,
    transactions: [],
    isLoading: false,
    isLocked: false,
    hasStoredWallet: true,
    storedAddress: ALICE.address,
    storedAuthMethod: 'seed',
    error: null,
  });
  localStorage.clear();
});

describe('SendPage — amount field validation', () => {
  it('disables submit button while either field is empty', async () => {
    const user = userEvent.setup();
    render(<SendPage />);

    const submit = await screen.findByTestId('send-submit-btn');
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId('send-amount-input'), '0.001');
    expect(submit).toBeEnabled();
  });

  it('renders an Invalid-amount error for unparseable text', async () => {
    const user = userEvent.setup();
    render(<SendPage />);

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), 'abc');
    await user.click(screen.getByTestId('send-submit-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent('Invalid amount');
  });

  it('renders an Insufficient-balance error when amount exceeds balance', async () => {
    const user = userEvent.setup();
    render(<SendPage />);

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    // Balance is 1 BTC; ask for 2 BTC.
    await user.type(screen.getByTestId('send-amount-input'), '2');
    await user.click(screen.getByTestId('send-submit-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent('Insufficient balance');
  });

  it('Set-max button fills the amount field with the formatted balance', async () => {
    const user = userEvent.setup();
    render(<SendPage />);

    const amountInput = (await screen.findByTestId('send-amount-input')) as HTMLInputElement;
    expect(amountInput.value).toBe('');

    await user.click(screen.getByTestId('send-setmax-btn'));
    // formatBtc(100_000_000) → "1.00000000" — assert non-empty + correct sat count.
    expect(amountInput.value).not.toBe('');
    expect(parseFloat(amountInput.value)).toBeCloseTo(1, 8);
  });

  it('Set-max button stays disabled when balance is zero', async () => {
    useWalletStore.setState({ balance: 0 });
    render(<SendPage />);

    const setMax = await screen.findByTestId('send-setmax-btn');
    expect(setMax).toBeDisabled();
  });

  it('clears any existing error when the amount validates successfully', async () => {
    const user = userEvent.setup();
    render(<SendPage />);

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), 'abc');
    await user.click(screen.getByTestId('send-submit-btn'));
    expect(await screen.findByTestId('send-error')).toBeInTheDocument();

    await user.clear(screen.getByTestId('send-amount-input'));
    await user.type(screen.getByTestId('send-amount-input'), '0.001');
    await user.click(screen.getByTestId('send-submit-btn'));

    // The confirm-card opening implies validation passed; the inline
    // error is cleared as a side-effect of the same setState batch.
    await waitFor(() => {
      expect(screen.queryByTestId('send-error')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('send-confirm-card')).toBeInTheDocument();
  });
});
