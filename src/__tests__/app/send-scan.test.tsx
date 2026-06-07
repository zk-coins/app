/**
 * SendPage ↔ QrScanModal wiring (`src/app/send/page.tsx`).
 *
 * The modal itself is unit-tested in
 * `src/__tests__/components/QrScanModal.test.tsx`; here it is stubbed to
 * a pair of buttons so the assertions focus on the page wiring:
 *   - the Scan-QR button mounts the modal
 *   - a scan result fills the recipient input, flashes the "Address
 *     scanned" confirmation, and unmounts the modal
 *   - the confirmation auto-clears after 1.5 s
 *   - closing the modal leaves the recipient untouched
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SendPage from '@/app/send/page';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';

const FEATURES_STATE = vi.hoisted(() => ({
  APPS_DIRECTORY: false,
  PASSKEY: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
  USERNAME_CLAIM: false,
}));

vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

// Stub the scanner with two buttons that drive its public contract.
const SCANNED_ADDRESS = 'deadbeef@dev.zkcoins.app';
vi.mock('@/components/QrScanModal', () => ({
  QrScanModal: ({ onResult, onClose }: { onResult: (r: string) => void; onClose: () => void }) => (
    <div data-testid="qr-scan-modal-stub">
      <button data-testid="stub-scan-result" onClick={() => onResult(SCANNED_ADDRESS)}>
        result
      </button>
      <button data-testid="stub-scan-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

const ALICE = {
  address: 'a'.repeat(64),
  numPubkeys: 0,
  xpriv: 'xprv-alice',
};

beforeEach(() => {
  useNetworkStore.setState({
    apiUrl: 'https://test-api.zkcoins.app',
    usernameDomain: 'dev.zkcoins.app',
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
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SendPage — scan-QR wiring', () => {
  it('opens the scanner, fills the recipient, and flashes confirmation', async () => {
    const user = userEvent.setup();
    render(<SendPage />);

    expect(screen.queryByTestId('qr-scan-modal-stub')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('send-scan-qr-btn'));
    // The modal is lazy-loaded (next/dynamic), so it resolves on a tick.
    await user.click(await screen.findByTestId('stub-scan-result'));

    expect(screen.getByTestId('send-recipient-input')).toHaveValue(SCANNED_ADDRESS);
    expect(screen.getByTestId('send-scan-feedback')).toBeInTheDocument();
    // The modal closes itself once a result lands.
    expect(screen.queryByTestId('qr-scan-modal-stub')).not.toBeInTheDocument();
  });

  it('clears the confirmation flash after 1.5 s', async () => {
    vi.useFakeTimers();
    render(<SendPage />);

    // fireEvent (synchronous) sidesteps userEvent's internal delays, which
    // deadlock against fake timers.
    fireEvent.click(screen.getByTestId('send-scan-qr-btn'));
    // Flush the next/dynamic chunk (the mocked module resolves on microtasks).
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByTestId('stub-scan-result'));
    expect(screen.getByTestId('send-scan-feedback')).toBeInTheDocument();

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
    await user.click(await screen.findByTestId('stub-scan-close'));

    expect(screen.queryByTestId('qr-scan-modal-stub')).not.toBeInTheDocument();
    expect(screen.getByTestId('send-recipient-input')).toHaveValue('bob');
    expect(screen.queryByTestId('send-scan-feedback')).not.toBeInTheDocument();
  });
});
