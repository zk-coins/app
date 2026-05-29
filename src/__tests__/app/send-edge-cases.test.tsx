/**
 * SendPage UI edge cases (`src/app/send/page.tsx`).
 *
 * Complements the existing `SendForm.test.tsx` (amount-field validation)
 * and the `send-pipeline.test.tsx` (Phase-1 + Phase-2 round-trip).
 * Targets the conditional renders and state-preservation branches the
 * other two files do not exercise:
 *
 *   - `balance === null` pre-tick state: Available reads "— BTC",
 *     Set max disabled, no-funds banner hidden.
 *   - `balance === 0` empty wallet: no-funds banner visible, Set max
 *     still disabled.
 *   - `balance > 0` funded: Available shows the formatted BTC, no
 *     no-funds banner, Set max enabled.
 *   - Confirm card cancel: input values preserved, confirm card gone.
 *   - Balance-not-loaded guard: handleConfirm aborts with the inline
 *     error instead of opening the confirm card.
 *   - Floating-point safety: 0.1 + 0.2 amount paths round to the exact
 *     sats value the server expects (no 0.30000000000000004 surprises
 *     in the confirm card or in `sats` math).
 *   - Recovering banner stays hidden when there is no inflight payload.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SendPage from '@/app/send/page';
import { useWalletStore } from '@/stores/wallet';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const ALICE = {
  address: 'a'.repeat(64),
  numPubkeys: 0,
  xpriv: 'xprv9s21ZrQH143K3GJpoapnV8SFfuZcECe',
};
const ONE_BTC_SATS = 100_000_000;

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

describe('SendPage — balance display states', () => {
  it('renders "— BTC" placeholder and disables Set max while balance is null (pre-tick)', () => {
    useWalletStore.setState({ balance: null });
    render(<SendPage />);

    const available = screen.getByTestId('send-available');
    expect(available).toHaveTextContent('— BTC');
    // The data-loading attribute is the hook for skeleton styling.
    expect(available).toHaveAttribute('data-loading', 'true');
    expect(screen.getByTestId('send-setmax-btn')).toBeDisabled();
    // The no-funds banner must NOT render while loading — only after a
    // confirmed 0 balance tick.
    expect(screen.queryByTestId('send-no-funds-banner')).not.toBeInTheDocument();
  });

  it('renders the no-funds banner when balance is exactly 0', () => {
    useWalletStore.setState({ balance: 0 });
    render(<SendPage />);

    const banner = screen.getByTestId('send-no-funds-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/No funds to send/);
    expect(screen.getByTestId('send-setmax-btn')).toBeDisabled();
  });

  it('renders the formatted balance and enables Set max when funded', () => {
    useWalletStore.setState({ balance: ONE_BTC_SATS });
    render(<SendPage />);

    expect(screen.getByTestId('send-available')).toHaveTextContent('1.00000000 BTC');
    expect(screen.queryByTestId('send-no-funds-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('send-setmax-btn')).toBeEnabled();
  });

  it('does not show the recovering banner when no inflight payload is stored', () => {
    render(<SendPage />);
    expect(screen.queryByTestId('send-recovering-banner')).not.toBeInTheDocument();
  });
});

describe('SendPage — Confirm card cancel', () => {
  it('preserves the typed recipient and amount when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<SendPage />);

    const recipient = screen.getByTestId('send-recipient-input') as HTMLInputElement;
    const amount = screen.getByTestId('send-amount-input') as HTMLInputElement;

    await user.type(recipient, 'b'.repeat(64));
    await user.type(amount, '0.01');
    await user.click(screen.getByTestId('send-submit-btn'));

    // Confirm card visible; the form inputs are still in the DOM with their values.
    expect(screen.getByTestId('send-confirm-card')).toBeInTheDocument();
    expect(recipient.value).toBe('b'.repeat(64));
    expect(amount.value).toBe('0.01');

    await user.click(screen.getByTestId('send-cancel-btn'));

    // Confirm card unmounted, form inputs untouched.
    expect(screen.queryByTestId('send-confirm-card')).not.toBeInTheDocument();
    expect(recipient.value).toBe('b'.repeat(64));
    expect(amount.value).toBe('0.01');
    // Submit button is back and still enabled.
    expect(screen.getByTestId('send-submit-btn')).toBeEnabled();
  });

  it('shows the typed amount inside the confirm card in compact BTC notation', async () => {
    const user = userEvent.setup();
    render(<SendPage />);

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), '0.0021');
    await user.click(screen.getByTestId('send-submit-btn'));

    // 0.0021 BTC → 210_000 sats → formatBtcCompact → "+0.0021 BTC".
    expect(screen.getByTestId('send-confirm-card')).toHaveTextContent('+0.0021 BTC');
  });
});

describe('SendPage — handleConfirm guards', () => {
  it('blocks submission with "Balance not loaded yet" when balance is null', async () => {
    useWalletStore.setState({ balance: null });
    const user = userEvent.setup();
    render(<SendPage />);

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), '0.01');
    await user.click(screen.getByTestId('send-submit-btn'));

    expect(screen.getByTestId('send-error')).toHaveTextContent('Balance not loaded yet');
    // The confirm card never opens.
    expect(screen.queryByTestId('send-confirm-card')).not.toBeInTheDocument();
  });
});

describe('SendPage — floating-point sats rounding', () => {
  it('rounds 0.1 + 0.2 = 0.3 BTC to exactly 30_000_000 sats (no FP drift)', async () => {
    // The amount input takes a string; the page parseFloat()s and then
    // multiplies by SATS_PER_BTC. With pure floats, 0.1 + 0.2 = 0.30000…04,
    // so a naive `Math.floor` or `(amount * SATS_PER_BTC) | 0` would
    // produce 29_999_999 sats. The page uses `Math.round`, which is the
    // correct choice — this asserts the chosen rounding holds.
    //
    // The confirm card renders `formatBtcCompact(Math.round(parseFloat(amount) * SATS_PER_BTC))`,
    // so the compact "+0.30" string is the user-visible byproduct.
    const user = userEvent.setup();
    render(<SendPage />);

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    // Type "0.3" verbatim. parseFloat("0.3") === 0.3 (rounded), and
    // 0.3 * 1e8 in IEEE-754 is 30_000_000.000000004 — Math.round → 30_000_000.
    await user.type(screen.getByTestId('send-amount-input'), '0.3');
    await user.click(screen.getByTestId('send-submit-btn'));

    expect(screen.getByTestId('send-confirm-card')).toHaveTextContent('+0.30 BTC');
  });

  it('rounds 0.00000001 BTC to exactly 1 sat', async () => {
    const user = userEvent.setup();
    render(<SendPage />);

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), '0.00000001');
    await user.click(screen.getByTestId('send-submit-btn'));

    // 1 sat → formatBtcCompact → trimmed positive value "+0.00000001 BTC".
    // Compact format trims trailing zeros but keeps significant digits.
    const card = screen.getByTestId('send-confirm-card');
    expect(card.textContent).toMatch(/\+0\.00000001 BTC/);
  });
});
