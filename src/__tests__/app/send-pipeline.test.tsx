/**
 * SendPage end-to-end pipeline test (`src/app/send/page.tsx`).
 *
 * Drives the real component with mocked `fetch` / WASM / `next/navigation`
 * and exercises the branches that the existing `SendForm.test.tsx`
 * (amount-field validation) and `e2e/07-send.spec.ts` (happy-path
 * screenshots against the live DEV server) leave uncovered:
 *
 *   - Phase-1 (`/api/send`) + Phase-2 (`/api/commit`) round-trip,
 *     including the success-screen transition and a transaction-log
 *     row landing in the wallet store.
 *   - The 3-attempt commit retry loop with 2 s / 4 s back-off, both
 *     success-on-retry and full exhaustion → user-visible error.
 *   - The in-flight-commit crash recovery effect: the `recovering`
 *     banner state, `clearInflightCommit` on success, and the
 *     preservation of the inflight payload on failure (next reload
 *     retries).
 *   - Username resolution branches gated by `FEATURES.USERNAMES`
 *     (`@zkcoins.app` suffix, `$` prefix, hex fast-path).
 *   - The `account.xpriv` defensive throw.
 *
 * `vi.useFakeTimers()` advances the 2 s / 4 s backoff and the 100 ms
 * no-account redirect window deterministically; without that the
 * retry-exhaustion test would block the suite for 6 real seconds.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SendPage from '@/app/send/page';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';

// Per-test toggle for FEATURES — exported as a mutable holder so the
// mock factory below can read the current value at call time. Using
// `vi.hoisted` keeps the holder defined when the hoisted `vi.mock`
// factory evaluates.
const FEATURES_STATE = vi.hoisted(() => ({
  USERNAMES: false,
  APPS_DIRECTORY: false,
  PASSKEY: false,
  FAUCET: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
}));

vi.mock('@/lib/features', () => ({ FEATURES: FEATURES_STATE }));

const routerReplace = vi.fn();
const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: routerPush }),
}));

const ALICE = {
  address: 'a'.repeat(64),
  numPubkeys: 2,
  xpriv: 'xprv9s21ZrQH143K3GJpoapnV8SFfuZcECe',
};
const ONE_BTC_SATS = 100_000_000;
const SEND_AMOUNT_BTC = '0.001'; // → 100_000 sats, well below 1 BTC.
const SEND_AMOUNT_SATS = 100_000;
const RECIPIENT_HEX = 'b'.repeat(64);

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

/** Convenience: enqueue the next fetch call to resolve with a JSON body. */
function enqueueOk<T>(data: T, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function enqueueErr(status: number, body = 'error') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve({ error: body }),
    text: () => Promise.resolve(body),
  });
}

function findCall(urlSubstring: string): RequestInit | undefined {
  const call = mockFetch.mock.calls.find(([url]) => String(url).includes(urlSubstring));
  return call?.[1] as RequestInit | undefined;
}

beforeEach(() => {
  // `vi.clearAllMocks()` only clears call history — `mockResolvedValueOnce`
  // queues survive. Explicit reset of `mockFetch` is what drops the queue.
  mockFetch.mockReset();
  routerReplace.mockClear();
  routerPush.mockClear();
  // Reset FEATURES to PRD-equivalent (everything off).
  Object.assign(FEATURES_STATE, {
    USERNAMES: false,
    APPS_DIRECTORY: false,
    PASSKEY: false,
    FAUCET: false,
    DEV_ROUTES: false,
    AUTO_LOCK: false,
    ADDRESS_ROTATION: false,
    TOR_ROUTING: false,
  });
  globalThis.fetch = mockFetch;
  useNetworkStore.setState({ apiUrl: 'https://test-api.zkcoins.app' });
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

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

/** Drive the UI from a blank /send through both submit buttons. */
async function clickThroughToConfirm(user: ReturnType<typeof userEvent.setup>, recipient: string) {
  await user.type(await screen.findByTestId('send-recipient-input'), recipient);
  await user.type(screen.getByTestId('send-amount-input'), SEND_AMOUNT_BTC);
  await user.click(screen.getByTestId('send-submit-btn'));
  await screen.findByTestId('send-confirm-card');
}

describe('SendPage — Phase-1 + Phase-2 happy path', () => {
  it('sends, commits, refreshes balance, prepends a transaction, and shows the success screen', async () => {
    const user = userEvent.setup();
    // /api/send — Phase-1 response carries the commitment material for Phase-2.
    enqueueOk({
      success: true,
      proof_id: 1234,
      account_state_hash: 'abc123',
      output_coins_root: 'def456',
    });
    // /api/commit succeeds on the first attempt.
    enqueueOk({ success: true, proof_id: 1234 });
    // Post-send balance refresh.
    enqueueOk({ balance: ONE_BTC_SATS - SEND_AMOUNT_SATS });

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));

    // Success screen renders.
    expect(await screen.findByTestId('send-success-heading')).toHaveTextContent('Sent privately');
    expect(screen.getByTestId('proof-id')).toHaveTextContent('1234');

    // Side effects landed in the store.
    const state = useWalletStore.getState();
    expect(state.balance).toBe(ONE_BTC_SATS - SEND_AMOUNT_SATS);
    expect(state.account?.numPubkeys).toBe(ALICE.numPubkeys + 1);
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0]).toMatchObject({
      type: 'send',
      amount: SEND_AMOUNT_SATS,
      counterparty: RECIPIENT_HEX,
      proofId: '1234',
    });

    // Inflight commit was cleared at the end of the loop.
    expect(localStorage.getItem('zkcoins_inflight_commit')).toBeNull();

    // The /api/send request shape is what the server expects.
    const sendCall = findCall('/api/send');
    expect(sendCall?.method).toBe('POST');
    const sendBody = JSON.parse(sendCall!.body as string);
    expect(sendBody.account_address).toBe(ALICE.address);
    expect(sendBody.recipient).toBe(RECIPIENT_HEX);
    expect(sendBody.amount).toBe(SEND_AMOUNT_SATS);
    // sendSigned attaches signature + timestamp — exact values come from WASM mock.
    expect(typeof sendBody.signature).toBe('string');
    expect(typeof sendBody.timestamp).toBe('number');
    // numPubkeys=2 → prev_commitment_pubkey is set.
    expect(sendBody.prev_commitment_pubkey).toBeDefined();
  });

  it('skips the Phase-2 commit when the server omits commitment material', async () => {
    // The Phase-2 block is gated by `account_state_hash && output_coins_root
    // && proof_id`. A mint-style envelope without commitment material is a
    // legitimate path the page must tolerate.
    const user = userEvent.setup();
    enqueueOk({ success: true, proof_id: 99 });
    enqueueOk({ balance: ONE_BTC_SATS - SEND_AMOUNT_SATS });

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));

    await screen.findByTestId('send-success-heading');
    // Only /api/send + /api/balance were called — no /api/commit.
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/api/commit'))).toBe(false);
    expect(useWalletStore.getState().transactions).toHaveLength(1);
  });
});

describe('SendPage — commit retry loop', () => {
  /**
   * Collapse the 2 s / 4 s retry back-off to a microtask so the assertions
   * run inside the default test budget. Only the retry tests need this —
   * the rest of the suite uses real timers. Only delays of exactly 2 s
   * or 4 s (the back-off pattern in `send()`) are intercepted; every
   * other `setTimeout` call (incl. the 120 s `AbortController` guard
   * in `request()` and userEvent's internal scheduling) is delegated to
   * the real timer so the wider page lifecycle is untouched.
   */
  function stubBackoffToMicrotask() {
    const real = globalThis.setTimeout;
    return vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      cb: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 2_000 || delay === 4_000) {
        queueMicrotask(() => cb());
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return real(cb, delay as number, ...(args as []));
    }) as unknown as typeof setTimeout);
  }

  it('succeeds on the second commit attempt after backing off 2 s', async () => {
    const user = userEvent.setup();
    enqueueOk({
      success: true,
      proof_id: 7,
      account_state_hash: 'asm',
      output_coins_root: 'ocr',
    });
    enqueueErr(500, 'commit failed'); // attempt 1
    enqueueOk({ success: true, proof_id: 7 }); // attempt 2
    enqueueOk({ balance: 50_000 });

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    const timerSpy = stubBackoffToMicrotask();
    await user.click(screen.getByTestId('send-confirm-btn'));

    await screen.findByTestId('send-success-heading');

    const commitCalls = mockFetch.mock.calls.filter(([url]) => String(url).includes('/api/commit'));
    expect(commitCalls).toHaveLength(2);
    expect(localStorage.getItem('zkcoins_inflight_commit')).toBeNull();
    // The retry loop ran one back-off (2 s) before attempt 2.
    expect(timerSpy).toHaveBeenCalledWith(expect.any(Function), 2_000);
    timerSpy.mockRestore();
  });

  it('exhausts all three commit attempts, shows the delivery-failed error, and keeps the inflight payload', async () => {
    const user = userEvent.setup();
    enqueueOk({
      success: true,
      proof_id: 8,
      account_state_hash: 'asm',
      output_coins_root: 'ocr',
    });
    enqueueErr(500); // attempt 1
    enqueueErr(500); // attempt 2
    enqueueErr(500); // attempt 3

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    const timerSpy = stubBackoffToMicrotask();
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent(
      /Transaction sent but delivery to recipient failed/,
    );

    const commitCalls = mockFetch.mock.calls.filter(([url]) => String(url).includes('/api/commit'));
    expect(commitCalls).toHaveLength(3);
    // Back-offs of 2 s and 4 s ran; the third attempt has no follow-up wait.
    expect(timerSpy).toHaveBeenCalledWith(expect.any(Function), 2_000);
    expect(timerSpy).toHaveBeenCalledWith(expect.any(Function), 4_000);
    // Inflight payload survives so a future SendPage mount can retry.
    const inflight = JSON.parse(localStorage.getItem('zkcoins_inflight_commit')!);
    expect(inflight.proof_id).toBe(8);
    timerSpy.mockRestore();
  });
});

describe('SendPage — in-flight commit recovery on mount', () => {
  it('replays the persisted commit, clears the payload, and refreshes balance', async () => {
    // Pre-seed the in-flight payload as if the previous session crashed
    // after `saveInflightCommit` but before `clearInflightCommit`.
    localStorage.setItem(
      'zkcoins_inflight_commit',
      JSON.stringify({
        proof_id: 42,
        public_key: '02' + 'cc'.repeat(32),
        signature: 'dd'.repeat(64),
        message: 'ee'.repeat(32),
      }),
    );
    enqueueOk({ success: true, proof_id: 42 }); // recovery /api/commit
    enqueueOk({ balance: 12345 }); // recovery balance refresh

    render(<SendPage />);

    await waitFor(() => {
      expect(localStorage.getItem('zkcoins_inflight_commit')).toBeNull();
    });
    expect(mockFetch.mock.calls[0][0]).toContain('/api/commit');
    expect(useWalletStore.getState().balance).toBe(12345);
    expect(useWalletStore.getState().account?.numPubkeys).toBe(ALICE.numPubkeys + 1);
  });

  it('keeps the inflight payload when recovery commit fails', async () => {
    const payload = {
      proof_id: 99,
      public_key: '02' + 'cc'.repeat(32),
      signature: 'dd'.repeat(64),
      message: 'ee'.repeat(32),
    };
    localStorage.setItem('zkcoins_inflight_commit', JSON.stringify(payload));
    enqueueErr(503, 'server unavailable');

    render(<SendPage />);

    await waitFor(() => {
      expect(mockFetch.mock.calls[0][0]).toContain('/api/commit');
    });
    // Payload preserved so the *next* SendPage mount tries again.
    const stillThere = JSON.parse(localStorage.getItem('zkcoins_inflight_commit')!);
    expect(stillThere).toEqual(payload);
    // No balance fetch followed.
    expect(mockFetch.mock.calls).toHaveLength(1);
  });

  it('treats a malformed inflight blob as "no recovery"', async () => {
    localStorage.setItem('zkcoins_inflight_commit', '{ broken json');
    render(<SendPage />);
    // Allow any deferred effects to drain.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockFetch).not.toHaveBeenCalled();
    // The page still renders the form (not the recovering banner).
    expect(screen.queryByTestId('send-recovering-banner')).not.toBeInTheDocument();
  });
});

describe('SendPage — username resolution (FEATURES.USERNAMES on)', () => {
  it('strips the @zkcoins.app suffix and calls /api/username/resolve', async () => {
    FEATURES_STATE.USERNAMES = true;
    const user = userEvent.setup();

    enqueueOk({ username: 'bob', address: RECIPIENT_HEX }); // resolveUsername
    enqueueOk({ success: true, proof_id: 1 });
    enqueueOk({ balance: 1 });

    render(<SendPage />);
    await clickThroughToConfirm(user, 'bob@zkcoins.app');
    await user.click(screen.getByTestId('send-confirm-btn'));
    await screen.findByTestId('send-success-heading');

    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://test-api.zkcoins.app/api/username/resolve/bob',
    );
    // The send body must carry the *resolved* hex recipient, not the username.
    const sendBody = JSON.parse(findCall('/api/send')!.body as string);
    expect(sendBody.recipient).toBe(RECIPIENT_HEX);
  });

  it('strips the leading $ prefix before resolving', async () => {
    FEATURES_STATE.USERNAMES = true;
    const user = userEvent.setup();

    enqueueOk({ username: 'alice', address: RECIPIENT_HEX });
    enqueueOk({ success: true, proof_id: 1 });
    enqueueOk({ balance: 1 });

    render(<SendPage />);
    await clickThroughToConfirm(user, '$alice');
    await user.click(screen.getByTestId('send-confirm-btn'));
    await screen.findByTestId('send-success-heading');

    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://test-api.zkcoins.app/api/username/resolve/alice',
    );
  });

  it('skips resolution for a 64-char hex recipient', async () => {
    FEATURES_STATE.USERNAMES = true;
    const user = userEvent.setup();

    enqueueOk({ success: true, proof_id: 1 });
    enqueueOk({ balance: 1 });

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));
    await screen.findByTestId('send-success-heading');

    // First call is /api/send directly — no resolve hop.
    expect(mockFetch.mock.calls[0][0]).toContain('/api/send');
  });

  it('surfaces the API error when username resolution fails', async () => {
    FEATURES_STATE.USERNAMES = true;
    const user = userEvent.setup();

    enqueueErr(404, 'Username not found');

    render(<SendPage />);
    await clickThroughToConfirm(user, 'ghost');
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent(/Username not found/);
    // /api/send was never reached.
    expect(mockFetch.mock.calls.every(([url]) => !String(url).includes('/api/send'))).toBe(true);
  });
});

describe('SendPage — defensive branches', () => {
  it('throws "No private key" when account.xpriv is empty', async () => {
    useWalletStore.setState({
      account: { ...ALICE, xpriv: '' },
      balance: ONE_BTC_SATS,
    });
    const user = userEvent.setup();

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent(/No private key/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('redirects to / when no account is set', async () => {
    useWalletStore.setState({ account: null, balance: null });

    vi.useFakeTimers();
    render(<SendPage />);
    // The placeholder is rendered immediately because `account` is null.
    expect(screen.getByTestId('redirecting-placeholder')).toBeInTheDocument();
    // The redirect is gated by a 100 ms grace timeout.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(routerReplace).toHaveBeenCalledWith('/');
  });

  it('does not redirect if the account appears within the 100 ms grace window', async () => {
    useWalletStore.setState({ account: null, balance: null });

    vi.useFakeTimers();
    render(<SendPage />);
    // Account lands before the 100 ms timer expires — the redirect is suppressed.
    act(() => {
      useWalletStore.setState({ account: ALICE, balance: ONE_BTC_SATS });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(routerReplace).not.toHaveBeenCalled();
  });
});
