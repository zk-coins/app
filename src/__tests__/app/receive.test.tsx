/**
 * ReceivePage — only name payloads that Send accepts are offered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReceivePage from '@/app/receive/page';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { toZkAddress } from '@/lib/format';
import { extractRecipient } from '@/lib/qr';

const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  usePathname: () => '/receive',
}));

const ALICE = {
  username: 'alice',
  address: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};
const DOMAIN = 'zkcoins.app';
const ALICE_ZK = toZkAddress(ALICE.username ?? 'alice', DOMAIN);

beforeEach(() => {
  routerReplace.mockClear();
  useNetworkStore.setState({
    network: 'regtest',
    usernameDomain: DOMAIN,
    infoError: null,
    infoLoaded: true,
  });
  useWalletStore.setState({
    account: ALICE,
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

describe('ReceivePage — name path', () => {
  it('renders QR + name and the payload is accepted by extractRecipient', () => {
    render(<ReceivePage />);
    expect(screen.getByTestId('receive-heading')).toHaveTextContent('Receive');
    expect(screen.getByTestId('qr-code')).toBeInTheDocument();
    expect(screen.getByTestId('receive-copy-btn')).toHaveTextContent('Copy name');
    expect(screen.getByText(ALICE_ZK)).toBeInTheDocument();
    // Property under test: Receive→Scan→Send round-trip shape.
    expect(extractRecipient(ALICE_ZK)).toBe(ALICE_ZK);
  });

  it('without a name marks receive as not available (no zk1 payload)', () => {
    useWalletStore.setState({
      account: { ...ALICE, username: undefined },
    });
    render(<ReceivePage />);
    expect(screen.getByTestId('receive-not-available')).toBeInTheDocument();
    expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receive-copy-btn')).not.toBeInTheDocument();
    // Raw address is not a Send-accepted recipient.
    expect(extractRecipient(ALICE.address)).toBeNull();
  });

  it('the back link routes to /', () => {
    render(<ReceivePage />);
    expect(screen.getByTestId('receive-back-link')).toHaveAttribute('href', '/');
  });
});

describe('ReceivePage — copy feedback', () => {
  it('flips the button to "Copied" after a successful clipboard write', async () => {
    const user = userEvent.setup();
    render(<ReceivePage />);

    const button = screen.getByTestId('receive-copy-btn');
    expect(button).toHaveTextContent('Copy name');
    expect(button).not.toHaveAttribute('data-copied');

    await user.click(button);
    await act(async () => {
      await Promise.resolve();
    });
    expect(button).toHaveTextContent('Copied');
    expect(button).toHaveAttribute('data-copied', 'true');
    await expect(navigator.clipboard.readText()).resolves.toBe(ALICE_ZK);
  });
});
