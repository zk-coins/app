/**
 * Single-asset surface of `src/app/send/page.tsx` (capability-adaptive
 * client, `multi_asset:false`).
 *
 * Against a single-asset node the send form has NO asset picker: it sends
 * the native asset, denominated in BTC, with the balance read from the
 * wallet store. These tests cover the render + validation + the two-phase
 * `api.walletSend` lifecycle (no asset_id on the wire).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
import SendPage from '@/app/send/page';
import { useWalletStore } from '@/stores/wallet';
import { useCapabilities } from '@/stores/capabilities';
import { api } from '@/lib/api/client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const ALICE = { address: 'a'.repeat(64), numPubkeys: 0, xpriv: 'xprv-alice' };
const SATS_PER_BTC = 100_000_000;

let walletSendSpy: ReturnType<typeof vi.spyOn>;
let walletBalanceSpy: ReturnType<typeof vi.spyOn>;
let resolveSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Runtime multi-asset capability OFF → single-asset send surface.
  useCapabilities.setState({
    capabilities: { address_list: false, username_claim: false, lnurl: false, multi_asset: false },
    loaded: true,
  });
  useWalletStore.setState({
    account: ALICE,
    balance: SATS_PER_BTC, // 1 BTC
    isLoading: false,
    isLocked: false,
    hasStoredWallet: true,
    storedAddress: ALICE.address,
    storedAuthMethod: 'seed',
    error: null,
  });
  walletSendSpy = vi.spyOn(api, 'walletSend').mockResolvedValue({
    job_id: 'wsend-1',
    status: 'completed',
    phase: 'completed',
    result: { success: true, proof_id: 7 },
  });
  walletBalanceSpy = vi
    .spyOn(api, 'walletBalance')
    .mockResolvedValue({ balance: SATS_PER_BTC, num_sends: 1 });
  resolveSpy = vi.spyOn(api, 'resolveUsername');
});

afterEach(() => {
  walletSendSpy.mockRestore();
  walletBalanceSpy.mockRestore();
  resolveSpy.mockRestore();
  vi.useRealTimers();
});

describe('SendPage — single-asset surface', () => {
  it('renders the BTC available readout and NO asset picker', async () => {
    render(<SendPage />);
    const available = await screen.findByTestId('send-available');
    expect(available).toHaveTextContent('1.00000000 BTC');
    expect(screen.queryByTestId('send-asset-select')).not.toBeInTheDocument();
  });

  it('disables submit until both fields are filled, then enables it', async () => {
    const user = userEvent.setup();
    render(<SendPage />);
    const submit = await screen.findByTestId('send-submit-btn');
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), '0.001');
    expect(submit).toBeEnabled();
  });

  it('drives the confirm → walletSend (no asset_id) → success flow', async () => {
    const user = userEvent.setup();
    render(<SendPage />);
    await screen.findByTestId('send-submit-btn');

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), '0.001');
    await user.click(screen.getByTestId('send-submit-btn'));

    await screen.findByTestId('send-confirm-card');
    await user.click(screen.getByTestId('send-confirm-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('send-success-heading')).toBeInTheDocument();
    });
    expect(walletSendSpy).toHaveBeenCalledTimes(1);
    const arg = walletSendSpy.mock.calls[0][0] as { amount: number; recipient: string };
    expect(arg.amount).toBe(Math.round(0.001 * SATS_PER_BTC));
    expect(screen.getByTestId('send-success-amount')).toBeInTheDocument();
  });

  it('shows the insufficient-balance error when the amount exceeds the balance', async () => {
    const user = userEvent.setup();
    render(<SendPage />);
    await screen.findByTestId('send-submit-btn');

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), '999');
    await user.click(screen.getByTestId('send-submit-btn'));

    expect(await screen.findByTestId('send-error')).toBeInTheDocument();
    expect(walletSendSpy).not.toHaveBeenCalled();
  });
});
