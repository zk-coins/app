/**
 * ReceivePage tests (`src/app/receive/page.tsx`).
 *
 * The page renders a QR for the user's zkAddress, an address text
 * card, and a Copy button with a 1.5 s "Copied" feedback flip. It
 * also bounces to `/` if no account is in the store, with a 100 ms
 * grace window that suppresses the redirect when the account lands
 * inside that window (race between `useEffect` mount and Zustand
 * hydration from a re-mount).
 *
 * `e2e/08-receive.spec.ts` covers the styled output but does not
 * lock in the copy-feedback timer, the clipboard reject path, or
 * the 100 ms redirect grace.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReceivePage from '@/app/receive/page';
import { useWalletStore } from '@/stores/wallet';
import { toZkAddress } from '@/lib/format';

const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  usePathname: () => '/receive',
}));

const ALICE = {
  address: 'a'.repeat(64),
  numPubkeys: 0,
  xpriv: 'xprv-alice',
};
const ALICE_ZK = toZkAddress(ALICE.address);

beforeEach(() => {
  routerReplace.mockClear();
  useWalletStore.setState({
    account: ALICE,
    balance: 0,
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ReceivePage — funded render', () => {
  it('renders the receive heading, QR, address card, and copy button', () => {
    render(<ReceivePage />);
    expect(screen.getByTestId('receive-heading')).toHaveTextContent('Receive Bitcoin');
    expect(screen.getByTestId('qr-code')).toBeInTheDocument();
    expect(screen.getByTestId('receive-copy-btn')).toHaveTextContent('Copy address');
    // The address card shows the zk-form of the address ({hex}@zkcoins.app).
    expect(screen.getByText(ALICE_ZK)).toBeInTheDocument();
  });

  it('the back link routes to /', () => {
    render(<ReceivePage />);
    expect(screen.getByTestId('receive-back-link')).toHaveAttribute('href', '/');
  });
});

describe('ReceivePage — copy feedback', () => {
  // happy-dom ships a working `navigator.clipboard.writeText` that
  // resolves successfully and stores the value in an in-memory
  // clipboard. The tests below rely on that real implementation
  // instead of fighting happy-dom's non-configurable navigator
  // property to swap in a mock.

  it('flips the button to "Copied" after a successful clipboard write', async () => {
    const user = userEvent.setup();
    render(<ReceivePage />);

    const button = screen.getByTestId('receive-copy-btn');
    expect(button).toHaveTextContent('Copy address');
    expect(button).not.toHaveAttribute('data-copied');

    await user.click(button);
    // The .then handler resolves on a microtask — wait for the flip.
    await act(async () => {
      await Promise.resolve();
    });
    expect(button).toHaveTextContent('Copied');
    expect(button).toHaveAttribute('data-copied', 'true');
    // happy-dom's clipboard captured the zk-form address.
    await expect(navigator.clipboard.readText()).resolves.toBe(ALICE_ZK);
  });

  it('reverts the button to "Copy address" after the 1.5 s timeout', async () => {
    // Collapse the 1.5 s `setTimeout(setCopied(false), 1500)` to a
    // microtask so the assertion lands inside the default test
    // budget. Targeting only delay=1500 leaves every other timer
    // (happy-dom clipboard internals, React effect scheduling)
    // untouched.
    const realSetTimeout = globalThis.setTimeout;
    const timerSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      cb: () => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 1_500) {
        queueMicrotask(cb);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(cb, delay as number, ...(args as []));
    }) as unknown as typeof setTimeout);

    const user = userEvent.setup();
    render(<ReceivePage />);
    await user.click(screen.getByTestId('receive-copy-btn'));
    // Two microtask drains: one for clipboard.writeText().then, one
    // for the queueMicrotask(setCopied(false)).
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('receive-copy-btn')).toHaveTextContent('Copy address');
    expect(timerSpy).toHaveBeenCalledWith(expect.any(Function), 1_500);
    timerSpy.mockRestore();
  });
});

describe('ReceivePage — no-account redirect', () => {
  it('renders the redirecting placeholder when no account is in the store', () => {
    useWalletStore.setState({ account: null });
    render(<ReceivePage />);
    expect(screen.getByTestId('redirecting-placeholder')).toBeInTheDocument();
    // The Receive content is suppressed.
    expect(screen.queryByTestId('receive-heading')).not.toBeInTheDocument();
  });

  it('calls router.replace("/") after the 100 ms grace window expires', async () => {
    useWalletStore.setState({ account: null });
    vi.useFakeTimers();
    render(<ReceivePage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(routerReplace).toHaveBeenCalledWith('/');
  });

  it('suppresses the redirect when the account lands inside the 100 ms grace window', async () => {
    useWalletStore.setState({ account: null });
    vi.useFakeTimers();
    render(<ReceivePage />);
    act(() => {
      useWalletStore.setState({ account: ALICE });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(routerReplace).not.toHaveBeenCalled();
  });
});
