/**
 * Single-asset surface handler coverage for `src/app/send/page.tsx`
 * (`multi_asset:false`).
 *
 * `send-single-asset.test.tsx` covers the render + validation + the
 * `api.walletSend` lifecycle; the scan/Set-max/cancel/Done/phase handlers
 * and the no-funds banner are only exercised on the multi-asset surface in
 * the other suites. This file drives them on the single-asset surface so
 * every route-component handler is covered on both code paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
import SendPage from '@/app/send/page';
import { useWalletStore } from '@/stores/wallet';
import { useCapabilities } from '@/stores/capabilities';
import { api, type JobStatus } from '@/lib/api/client';

// Module-level router spy so the Done button's `router.push('/')` is
// assertable (an inline `push: vi.fn()` would be a fresh mock per render).
const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: routerPush }),
  useSearchParams: () => new URLSearchParams(),
}));

// Stub the lazily (`next/dynamic`) loaded scanner with two buttons that
// drive its public contract, queried by role/name (no orphan testids).
const SCANNED_ADDRESS = 'b'.repeat(64);
vi.mock('@/components/QrScanModal', () => ({
  QrScanModal: ({ onResult, onClose }: { onResult: (r: string) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="scanner-stub">
      <button onClick={() => onResult(SCANNED_ADDRESS)}>stub scan result</button>
      <button onClick={onClose}>stub scan close</button>
    </div>
  ),
}));

const ALICE = { address: 'a'.repeat(64), numPubkeys: 0, xpriv: 'xprv-alice' };
const SATS_PER_BTC = 100_000_000;

function singleAssetSurface() {
  useCapabilities.setState({
    capabilities: { address_list: false, username_claim: false, lnurl: false, multi_asset: false },
    loaded: true,
  });
}

beforeEach(() => {
  routerPush.mockClear();
  singleAssetSurface();
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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('SendPage (single-asset) — scan-QR wiring', () => {
  it('opens the scanner, fills the recipient, flashes and auto-clears the confirmation', async () => {
    vi.useFakeTimers();
    render(<SendPage />);

    fireEvent.click(screen.getByTestId('send-scan-qr-btn'));
    // Flush the next/dynamic chunk (the mocked module resolves on microtasks).
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'stub scan result' }));

    expect(screen.getByTestId('send-recipient-input')).toHaveValue(SCANNED_ADDRESS);
    expect(screen.getByTestId('send-scan-feedback')).toBeInTheDocument();

    // The 1.5 s flash auto-clears.
    act(() => {
      vi.advanceTimersByTime(1_600);
    });
    expect(screen.queryByTestId('send-scan-feedback')).not.toBeInTheDocument();
  });

  it('closing the scanner leaves the recipient untouched', async () => {
    const user = userEvent.setup();
    render(<SendPage />);

    await user.type(screen.getByTestId('send-recipient-input'), 'bob');
    await user.click(screen.getByTestId('send-scan-qr-btn'));
    await user.click(await screen.findByRole('button', { name: 'stub scan close' }));

    expect(screen.queryByRole('dialog', { name: 'scanner-stub' })).not.toBeInTheDocument();
    expect(screen.getByTestId('send-recipient-input')).toHaveValue('bob');
  });
});

describe('SendPage (single-asset) — Set max', () => {
  it('fills the amount field with the full BTC balance', async () => {
    const user = userEvent.setup();
    render(<SendPage />);

    await user.click(screen.getByTestId('send-setmax-btn'));
    expect(screen.getByTestId('send-amount-input')).toHaveValue('1.00000000');
  });
});

describe('SendPage (single-asset) — Confirm card cancel', () => {
  it('preserves the typed inputs when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<SendPage />);

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), '0.001');
    await user.click(screen.getByTestId('send-submit-btn'));

    expect(screen.getByTestId('send-confirm-card')).toBeInTheDocument();
    await user.click(screen.getByTestId('send-cancel-btn'));

    expect(screen.queryByTestId('send-confirm-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('send-recipient-input')).toHaveValue('b'.repeat(64));
    expect(screen.getByTestId('send-amount-input')).toHaveValue('0.001');
  });
});

describe('SendPage (single-asset) — send lifecycle phase + Done', () => {
  it('forwards job phases, then Done routes home', async () => {
    const walletSendSpy = vi.spyOn(api, 'walletSend').mockImplementation((async (
      _req: unknown,
      opts: { onPhase?: (s: JobStatus) => void },
    ) => {
      opts.onPhase?.({ job_id: 'wsend-1', status: 'proving', phase: 'proving' } as JobStatus);
      return {
        job_id: 'wsend-1',
        status: 'completed',
        phase: 'completed',
        result: { success: true, proof_id: 7 },
      } as JobStatus;
    }) as unknown as typeof api.walletSend);
    vi.spyOn(api, 'walletBalance').mockResolvedValue({ balance: SATS_PER_BTC, num_sends: 1 });

    const user = userEvent.setup();
    render(<SendPage />);

    await user.type(screen.getByTestId('send-recipient-input'), 'b'.repeat(64));
    await user.type(screen.getByTestId('send-amount-input'), '0.001');
    await user.click(screen.getByTestId('send-submit-btn'));
    await user.click(screen.getByTestId('send-confirm-btn'));

    await screen.findByTestId('send-success-heading');
    expect(walletSendSpy).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /fertig|done/i }));
    expect(routerPush).toHaveBeenCalledWith('/');
  });
});

describe('SendPage (single-asset) — no-funds banner', () => {
  it('renders the receive/apps rich-text banner when the balance is exactly 0', async () => {
    useWalletStore.setState({ balance: 0 });
    render(<SendPage />);

    const banner = await screen.findByTestId('send-no-funds-banner');
    expect(banner).toBeInTheDocument();
    // The `receive` rich-text chunk renders an in-app link to /receive.
    await waitFor(() => {
      expect(banner.querySelector('a[href="/receive"]')).toBeInTheDocument();
    });
  });
});
