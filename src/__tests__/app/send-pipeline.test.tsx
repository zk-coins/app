/**
 * SendPage end-to-end pipeline test (`src/app/send/page.tsx`).
 *
 * Drives the real component with mocked `fetch` / WASM / `next/navigation`
 * over the async Jobs-API send lifecycle (`api.send`):
 *
 *   /api/balance (hydrate num_sends) → POST /api/jobs/send (202) →
 *   poll /api/jobs/:id → awaiting_signature (proof_id + ash/ocr in
 *   `result`) → POST /api/jobs/:id/commit → poll → completed →
 *   post-send /api/balance refresh → success screen + transaction row.
 *
 * Covers:
 *   - The happy-path round-trip, success-screen transition, store side
 *     effects, and the signed send-body shape.
 *   - Username resolution branches (`@zkcoins.app` suffix, `$` prefix,
 *     hex fast-path, foreign-stage suffix safety) — resolve is MVP.
 *   - The `account.xpriv` defensive throw.
 *   - Error surfacing: ApiError AND JobFailedError → the translated
 *     `userMessageFor` copy (issue #99 covers both the admit-time and
 *     the async job-failure leg); the no-account redirect window.
 *
 * `vi.useFakeTimers()` is used only for the redirect-window tests; the
 * lifecycle tests use real timers and stub the `waitForJob` poll floor
 * to a 0 s Retry-After so the polls resolve immediately.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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

/** A successful-job poll body with a 0 s Retry-After so the loop is fast. */
function enqueueJob<T extends object>(body: T): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers({ 'retry-after': '0' }),
  });
}

function enqueueOk<T>(data: T, status = 200): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  });
}

function enqueueErr(status: number, body = 'error'): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve({ error: body }),
    text: () => Promise.resolve(body),
    headers: new Headers(),
  });
}

/**
 * Enqueue the full happy-path send lifecycle after the username step:
 * balance hydrate → send admit → awaiting_signature → commit accept →
 * completed → post-send balance.
 */
function enqueueSendLifecycle(opts: { numSends?: number; proofId?: number } = {}): void {
  const numSends = opts.numSends ?? ALICE.numPubkeys;
  const proofId = opts.proofId ?? 1234;
  enqueueOk({ balance: ONE_BTC_SATS, num_sends: numSends }); // pre-send balance
  enqueueOk({ job_id: 'job-1', status: 'queued' }, 202); // send admit
  enqueueJob({
    job_id: 'job-1',
    kind: 'send',
    status: 'awaiting_signature',
    phase: 'awaiting_signature',
    proof_id: proofId,
    result: { success: true, account_state_hash: 'abc123', output_coins_root: 'def456' },
  });
  enqueueOk({ status: 'broadcasting' }); // commit accept
  enqueueJob({
    job_id: 'job-1',
    kind: 'send',
    status: 'completed',
    phase: 'completed',
    result: { success: true, proof_id: proofId },
  });
  enqueueOk({ balance: ONE_BTC_SATS - SEND_AMOUNT_SATS, num_sends: numSends + 1 }); // post-send balance
}

function findCall(urlSubstring: string): RequestInit | undefined {
  const call = mockFetch.mock.calls.find(([url]) => String(url).includes(urlSubstring));
  return call?.[1] as RequestInit | undefined;
}

beforeEach(() => {
  mockFetch.mockReset();
  routerReplace.mockClear();
  routerPush.mockClear();
  Object.assign(FEATURES_STATE, {
    APPS_DIRECTORY: false,
    PASSKEY: false,
    DEV_ROUTES: false,
    AUTO_LOCK: false,
    ADDRESS_ROTATION: false,
    TOR_ROUTING: false,
    USERNAME_CLAIM: false,
  });
  globalThis.fetch = mockFetch;
  useNetworkStore.setState({
    apiUrl: 'https://test-api.zkcoins.app',
    usernameDomain: 'zkcoins.app',
  });
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

describe('SendPage — jobs-API send lifecycle happy path', () => {
  it('hydrates, admits, commits, refreshes balance, prepends a transaction, shows success', async () => {
    const user = userEvent.setup();
    enqueueSendLifecycle();

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-success-heading')).toHaveTextContent('Sent privately');
    expect(screen.getByTestId('proof-id')).toHaveTextContent('1234');

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

    // The signed send admit hits /api/jobs/send with an Idempotency-Key.
    const sendCall = findCall('/api/jobs/send');
    expect(sendCall?.method).toBe('POST');
    expect((sendCall?.headers as Record<string, string>)['Idempotency-Key']).toBeDefined();
    const sendBody = JSON.parse(sendCall!.body as string);
    expect(sendBody.account_address).toBe(ALICE.address);
    expect(sendBody.recipient).toBe(RECIPIENT_HEX);
    expect(sendBody.amount).toBe(SEND_AMOUNT_SATS);
    expect(typeof sendBody.signature).toBe('string');
    expect(typeof sendBody.timestamp).toBe('number');
    // num_sends = 2 → prev_commitment_pubkey is set.
    expect(sendBody.prev_commitment_pubkey).toBeDefined();

    // The commit attaches the WASM-built commitment, keyed by job id.
    const commitCall = findCall('/commit');
    expect(commitCall?.method).toBe('POST');
    const commitBody = JSON.parse(commitCall!.body as string);
    expect(commitBody.proof_id).toBe(1234);
    expect(commitBody.message).toBeDefined();
  });

  it('omits prev_commitment_pubkey for a first-ever send (num_sends = 0)', async () => {
    const user = userEvent.setup();
    enqueueSendLifecycle({ numSends: 0, proofId: 7 });

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));
    await screen.findByTestId('send-success-heading');

    const sendBody = JSON.parse(findCall('/api/jobs/send')!.body as string);
    expect(sendBody.prev_commitment_pubkey).toBeUndefined();
  });
});

describe('SendPage — error surfacing', () => {
  it('shows the JobFailedError detail when the server omits ash/ocr (pre-#195 node)', async () => {
    const user = userEvent.setup();
    enqueueOk({ balance: ONE_BTC_SATS, num_sends: 0 }); // pre-send balance
    enqueueOk({ job_id: 'job-x', status: 'queued' }, 202); // send admit
    // awaiting_signature WITHOUT account_state_hash / output_coins_root.
    enqueueJob({
      job_id: 'job-x',
      kind: 'send',
      status: 'awaiting_signature',
      phase: 'awaiting_signature',
      proof_id: 5,
    });

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent(/account_state_hash/);
    // No /commit call — the wallet refuses to fabricate a commitment.
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes('/commit'))).toBe(false);
  });

  it('surfaces a translated ApiError when the send admit is rejected', async () => {
    const user = userEvent.setup();
    enqueueOk({ balance: ONE_BTC_SATS, num_sends: 0 });
    enqueueErr(422, 'Insufficient balance');

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-error')).toBeVisible();
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes('/commit'))).toBe(false);
  });

  it('shows the German userMessage when the job fails during proving (issue #99, async leg)', async () => {
    const user = userEvent.setup();
    enqueueOk({ balance: ONE_BTC_SATS, num_sends: 0 });
    enqueueOk({ job_id: 'job-f', status: 'queued' }, 202);
    enqueueJob({
      job_id: 'job-f',
      kind: 'send',
      status: 'failed',
      phase: 'failed',
      // A failure-contract string from the node's table — the async
      // JobFailedError leg must translate it exactly like an
      // admit-time ApiError would be.
      error: 'prove failed',
    });

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent(
      /Beweisgenerierung fehlgeschlagen\. Bitte später erneut versuchen\./,
    );
  });

  it('wraps an unmapped async job-failure string in the German fallback', async () => {
    const user = userEvent.setup();
    enqueueOk({ balance: ONE_BTC_SATS, num_sends: 0 });
    enqueueOk({ job_id: 'job-g', status: 'queued' }, 202);
    enqueueJob({
      job_id: 'job-g',
      kind: 'send',
      status: 'failed',
      phase: 'failed',
      error: 'prove_account_update failed',
    });

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));

    // Unmapped diagnostic → `Serverfehler <status>: <raw>` fallback, so
    // the raw string stays visible for debugging but inside the German
    // frame (never a bare stringly-typed blob, per issue #99).
    expect(await screen.findByTestId('send-error')).toHaveTextContent(
      /Serverfehler failed: prove_account_update failed/,
    );
  });
});

describe('SendPage — username resolution (MVP, always on)', () => {
  it('strips the @zkcoins.app suffix and calls /api/username/resolve', async () => {
    const user = userEvent.setup();
    enqueueOk({ username: 'bob', address: RECIPIENT_HEX }); // resolveUsername
    enqueueSendLifecycle({ numSends: 0 });

    render(<SendPage />);
    await clickThroughToConfirm(user, 'bob@zkcoins.app');
    await user.click(screen.getByTestId('send-confirm-btn'));
    await screen.findByTestId('send-success-heading');

    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://test-api.zkcoins.app/api/username/resolve/bob',
    );
    const sendBody = JSON.parse(findCall('/api/jobs/send')!.body as string);
    expect(sendBody.recipient).toBe(RECIPIENT_HEX);
  });

  it('strips the leading $ prefix before resolving', async () => {
    const user = userEvent.setup();
    enqueueOk({ username: 'alice', address: RECIPIENT_HEX });
    enqueueSendLifecycle({ numSends: 0 });

    render(<SendPage />);
    await clickThroughToConfirm(user, '$alice');
    await user.click(screen.getByTestId('send-confirm-btn'));
    await screen.findByTestId('send-success-heading');

    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://test-api.zkcoins.app/api/username/resolve/alice',
    );
  });

  it('skips resolution for a 64-char hex recipient', async () => {
    const user = userEvent.setup();
    enqueueSendLifecycle({ numSends: 0 });

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));
    await screen.findByTestId('send-success-heading');

    // First call is /api/balance (pre-send hydration), then /api/jobs/send.
    expect(mockFetch.mock.calls[0][0]).toContain('/api/balance');
    expect(mockFetch.mock.calls[1][0]).toContain('/api/jobs/send');
  });

  it('does NOT strip a foreign-stage suffix — cross-network safety', async () => {
    const user = userEvent.setup();
    enqueueErr(404, 'Username not found');

    render(<SendPage />);
    await clickThroughToConfirm(user, 'bob@dev.zkcoins.app');
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent(/Username not found/);
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://test-api.zkcoins.app/api/username/resolve/bob%40dev.zkcoins.app',
    );
    expect(mockFetch.mock.calls.every(([url]) => !String(url).includes('/api/jobs/send'))).toBe(
      true,
    );
  });

  it('surfaces the API error when username resolution fails', async () => {
    const user = userEvent.setup();
    enqueueErr(404, 'Username not found');

    render(<SendPage />);
    await clickThroughToConfirm(user, 'ghost');
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent(/Username not found/);
    expect(mockFetch.mock.calls.every(([url]) => !String(url).includes('/api/jobs/send'))).toBe(
      true,
    );
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
    expect(screen.getByTestId('redirecting-placeholder')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(routerReplace).toHaveBeenCalledWith('/');
  });

  it('does not redirect if the account appears within the 100 ms grace window', async () => {
    useWalletStore.setState({ account: null, balance: null });

    vi.useFakeTimers();
    render(<SendPage />);
    act(() => {
      useWalletStore.setState({ account: ALICE, balance: ONE_BTC_SATS });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(routerReplace).not.toHaveBeenCalled();
  });
});
