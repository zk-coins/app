/**
 * SendPage end-to-end pipeline test (`src/app/send/page.tsx`), neutral
 * multi-asset model.
 *
 * Drives the real component with a URL-routing `fetch` mock over the async
 * Jobs-API send lifecycle (`api.send`):
 *
 *   GET /api/balance/:address (portfolio + index hydration) →
 *   POST /api/jobs/send (202, carries asset_id) →
 *   poll /api/jobs/:id → awaiting_signature (proof_id + ash/ocr) →
 *   POST /api/jobs/:id/commit → poll → completed → success screen.
 *
 * The portfolio (`GET /api/balance/:address`) is served by a standing
 * route handler (it is polled on a timer by `usePortfolio` AND read by
 * `api.send` for index hydration); the one-shot lifecycle frames come from
 * a FIFO queue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
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
  useSearchParams: () => new URLSearchParams(),
}));

const ALICE = {
  address: 'a'.repeat(64),
  numPubkeys: 2,
  xpriv: 'xprv9s21ZrQH143K3GJpoapnV8SFfuZcECe',
};
const ASSET_ID = 'c'.repeat(64);
// 8-decimal asset so a typed "0.001" → 100_000 atomic units.
const ASSET_BALANCE = 100_000_000;
const SEND_AMOUNT_TYPED = '0.001';
const SEND_AMOUNT_RAW = 100_000;
const RECIPIENT_HEX = 'b'.repeat(64);

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

/** One-shot lifecycle responses, consumed FIFO for non-portfolio URLs. */
let queue: Array<{ ok: boolean; status: number; body: unknown; retryAfter?: string }>;
let portfolioNumSends = ALICE.numPubkeys;

function res(body: unknown, status = 200, retryAfter?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    headers: new Headers(retryAfter !== undefined ? { 'retry-after': retryAfter } : {}),
  };
}

function enqueue(body: unknown, status = 200, retryAfter?: string): void {
  queue.push({ ok: status >= 200 && status < 300, status, body, retryAfter });
}

/** Job poll frame with a 0 s Retry-After so the loop is fast. */
function enqueueJob(body: object): void {
  enqueue(body, 200, '0');
}

/** The send lifecycle after any username step: admit → awaiting → commit → completed. */
function enqueueSendLifecycle(proofId = 1234): void {
  enqueue({ job_id: 'job-1', status: 'queued' }, 202); // send admit
  enqueueJob({
    job_id: 'job-1',
    kind: 'send',
    status: 'awaiting_signature',
    phase: 'awaiting_signature',
    proof_id: proofId,
    result: { success: true, account_state_hash: 'abc123', output_coins_root: 'def456' },
  });
  enqueue({ status: 'broadcasting' }); // commit accept
  enqueueJob({
    job_id: 'job-1',
    kind: 'send',
    status: 'completed',
    phase: 'completed',
    result: { success: true, proof_id: proofId },
  });
}

function findCall(urlSubstring: string): RequestInit | undefined {
  const call = mockFetch.mock.calls.find(([url]) => String(url).includes(urlSubstring));
  return call?.[1] as RequestInit | undefined;
}

function portfolioBody() {
  return {
    address: ALICE.address,
    assets: [
      {
        asset_id: ASSET_ID,
        name: 'BigCoin',
        decimals: 8,
        balance: ASSET_BALANCE,
        num_sends: portfolioNumSends,
      },
    ],
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  routerReplace.mockClear();
  routerPush.mockClear();
  queue = [];
  portfolioNumSends = ALICE.numPubkeys;
  globalThis.fetch = mockFetch;
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
    // Portfolio read (usePortfolio poll + api.send hydration): standing route.
    if (/\/api\/balance\/[0-9a-f]+($|\?)/.test(u)) {
      return Promise.resolve(res(portfolioBody()));
    }
    const next = queue.shift();
    if (!next) return Promise.resolve(res({ error: 'unexpected call' }, 500));
    return Promise.resolve(res(next.body, next.status, next.retryAfter));
  });

  useNetworkStore.setState({
    apiUrl: 'https://test-api.zkcoins.app',
    usernameDomain: 'zkcoins.app',
  });
  useWalletStore.setState({
    account: ALICE,
    balance: ASSET_BALANCE,
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

async function clickThroughToConfirm(user: ReturnType<typeof userEvent.setup>, recipient: string) {
  await screen.findByTestId('send-asset-select');
  await user.type(screen.getByTestId('send-recipient-input'), recipient);
  await user.type(screen.getByTestId('send-amount-input'), SEND_AMOUNT_TYPED);
  await user.click(screen.getByTestId('send-submit-btn'));
  await screen.findByTestId('send-confirm-card');
}

describe('SendPage — jobs-API send lifecycle happy path', () => {
  it('hydrates, admits with asset_id, commits, shows success', async () => {
    const user = userEvent.setup();
    enqueueSendLifecycle();

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-success-heading')).toHaveTextContent('Privat gesendet');
    expect(screen.getByTestId('proof-id')).toHaveTextContent('1234');

    const sendCall = findCall('/api/jobs/send');
    expect(sendCall?.method).toBe('POST');
    expect((sendCall?.headers as Record<string, string>)['Idempotency-Key']).toBeDefined();
    const sendBody = JSON.parse(sendCall!.body as string);
    expect(sendBody.account_address).toBe(ALICE.address);
    expect(sendBody.recipient).toBe(RECIPIENT_HEX);
    expect(sendBody.amount).toBe(SEND_AMOUNT_RAW);
    expect(sendBody.asset_id).toBe(ASSET_ID);
    expect(typeof sendBody.signature).toBe('string');
    // num_sends total = 2 → prev_commitment_pubkey is set.
    expect(sendBody.prev_commitment_pubkey).toBeDefined();

    const commitCall = findCall('/commit');
    const commitBody = JSON.parse(commitCall!.body as string);
    expect(commitBody.proof_id).toBe(1234);
    expect(commitBody.message).toBeDefined();
  });

  it('omits prev_commitment_pubkey for a first-ever send (num_sends = 0)', async () => {
    portfolioNumSends = 0;
    const user = userEvent.setup();
    enqueueSendLifecycle(7);

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
    portfolioNumSends = 0;
    const user = userEvent.setup();
    enqueue({ job_id: 'job-x', status: 'queued' }, 202);
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
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes('/commit'))).toBe(false);
  });

  it('surfaces a translated ApiError when the send admit is rejected', async () => {
    portfolioNumSends = 0;
    const user = userEvent.setup();
    enqueue('Insufficient funds', 422);

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-error')).toBeVisible();
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes('/commit'))).toBe(false);
  });

  it('shows the German userMessage when the job fails during proving (issue #99 async leg)', async () => {
    portfolioNumSends = 0;
    const user = userEvent.setup();
    enqueue({ job_id: 'job-f', status: 'queued' }, 202);
    enqueueJob({
      job_id: 'job-f',
      kind: 'send',
      status: 'failed',
      phase: 'failed',
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
    portfolioNumSends = 0;
    const user = userEvent.setup();
    enqueue({ job_id: 'job-g', status: 'queued' }, 202);
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

    expect(await screen.findByTestId('send-error')).toHaveTextContent(
      /Serverfehler failed: prove_account_update failed/,
    );
  });
});

describe('SendPage — username resolution (MVP, always on)', () => {
  it('strips the @zkcoins.app suffix and calls /api/username/resolve', async () => {
    portfolioNumSends = 0;
    const user = userEvent.setup();
    enqueue({ username: 'bob', address: RECIPIENT_HEX }); // resolveUsername
    enqueueSendLifecycle(3);

    render(<SendPage />);
    await clickThroughToConfirm(user, 'bob@zkcoins.app');
    await user.click(screen.getByTestId('send-confirm-btn'));
    await screen.findByTestId('send-success-heading');

    expect(
      mockFetch.mock.calls.some(
        ([u]) => String(u) === 'https://test-api.zkcoins.app/api/username/resolve/bob',
      ),
    ).toBe(true);
    const sendBody = JSON.parse(findCall('/api/jobs/send')!.body as string);
    expect(sendBody.recipient).toBe(RECIPIENT_HEX);
  });

  it('strips the leading $ prefix before resolving', async () => {
    portfolioNumSends = 0;
    const user = userEvent.setup();
    enqueue({ username: 'alice', address: RECIPIENT_HEX });
    enqueueSendLifecycle(4);

    render(<SendPage />);
    await clickThroughToConfirm(user, '$alice');
    await user.click(screen.getByTestId('send-confirm-btn'));
    await screen.findByTestId('send-success-heading');

    expect(
      mockFetch.mock.calls.some(
        ([u]) => String(u) === 'https://test-api.zkcoins.app/api/username/resolve/alice',
      ),
    ).toBe(true);
  });

  it('skips resolution for a 64-char hex recipient', async () => {
    portfolioNumSends = 0;
    const user = userEvent.setup();
    enqueueSendLifecycle(5);

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));
    await screen.findByTestId('send-success-heading');

    expect(mockFetch.mock.calls.some(([u]) => String(u).includes('/username/resolve'))).toBe(false);
  });

  it('does NOT strip a foreign-stage suffix — cross-network safety', async () => {
    portfolioNumSends = 0;
    const user = userEvent.setup();
    enqueue('Username not found', 404);

    render(<SendPage />);
    await clickThroughToConfirm(user, 'bob@dev.zkcoins.app');
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent(/Username not found/);
    expect(
      mockFetch.mock.calls.some(
        ([u]) =>
          String(u) === 'https://test-api.zkcoins.app/api/username/resolve/bob%40dev.zkcoins.app',
      ),
    ).toBe(true);
    expect(mockFetch.mock.calls.every(([u]) => !String(u).includes('/api/jobs/send'))).toBe(true);
  });

  it('surfaces the API error when username resolution fails', async () => {
    portfolioNumSends = 0;
    const user = userEvent.setup();
    enqueue('Username not found', 404);

    render(<SendPage />);
    await clickThroughToConfirm(user, 'ghost');
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent(/Username not found/);
    expect(mockFetch.mock.calls.every(([u]) => !String(u).includes('/api/jobs/send'))).toBe(true);
  });
});

describe('SendPage — defensive branches', () => {
  it('throws "No private key" when account.xpriv is empty', async () => {
    useWalletStore.setState({ account: { ...ALICE, xpriv: '' }, balance: ASSET_BALANCE });
    const user = userEvent.setup();

    render(<SendPage />);
    await clickThroughToConfirm(user, RECIPIENT_HEX);
    await user.click(screen.getByTestId('send-confirm-btn'));

    expect(await screen.findByTestId('send-error')).toHaveTextContent(/Kein privater Schlüssel/);
    // No send admit attempted (only the portfolio polls hit fetch).
    expect(mockFetch.mock.calls.every(([u]) => !String(u).includes('/api/jobs/send'))).toBe(true);
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
      useWalletStore.setState({ account: ALICE, balance: ASSET_BALANCE });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(routerReplace).not.toHaveBeenCalled();
  });
});
