import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { z } from 'zod';
import { ApiError, JobFailedError, api, newIdempotencyKey } from '@/lib/api/client';
import { KNOWN_SERVER_ERRORS } from '@/lib/api/errorMessages';
import {
  BalanceResponseSchema,
  InfoResponseSchema,
  JobAcceptedSchema,
  JobStatusSchema,
} from '@zkcoins/sdk';
import { useNetworkStore } from '@/stores/network';

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
  useNetworkStore.setState({ apiUrl: 'https://test-api.zkcoins.app' });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

/**
 * Typed mock helper. Forcing the caller to pick a `z.infer<typeof
 * Schema>` makes any drift between the test's stub response and the
 * schema (and therefore the real server's expected shape) a TS error,
 * not a runtime surprise.
 */
function mockJsonResponse<T>(data: T, status = 200, headers: Record<string, string> = {}): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(headers),
  });
}

type JobAccepted = z.infer<typeof JobAcceptedSchema>;
type JobStatus = z.infer<typeof JobStatusSchema>;

describe('newIdempotencyKey', () => {
  it('produces an RFC-4122 v4 UUID', () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is unique across calls', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('api.mintJob', () => {
  it('POSTs /api/jobs/mint with the Idempotency-Key header', async () => {
    mockJsonResponse<JobAccepted>({ job_id: 'job-1', status: 'queued' }, 202);
    const accepted = await api.mintJob({ account_address: 'abc', amount: 5000 }, 'idem-key-1');
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.zkcoins.app/api/jobs/mint');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-key-1');
    expect(JSON.parse(init.body)).toEqual({ account_address: 'abc', amount: 5000 });
    expect(accepted.job_id).toBe('job-1');
  });
});

describe('api.sendJob', () => {
  it('POSTs /api/jobs/send with the Idempotency-Key header (signed body passthrough)', async () => {
    mockJsonResponse<JobAccepted>({ job_id: 'send-admit', status: 'queued' }, 202);
    const accepted = await api.sendJob(
      {
        account_address: 'aa'.repeat(32),
        recipient: 'bb'.repeat(32),
        amount: 1000,
        public_key: 'pk',
        next_public_key: 'npk',
        signature: 'sig',
        timestamp: 1700000000,
      },
      'idem-send-1',
    );
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.zkcoins.app/api/jobs/send');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-send-1');
    expect(JSON.parse(init.body).signature).toBe('sig');
    expect(accepted.job_id).toBe('send-admit');
  });
});

describe('api.mint (lifecycle)', () => {
  it('admits the job, polls to completed, and returns the terminal status', async () => {
    mockJsonResponse<JobAccepted>({ job_id: 'job-2', status: 'queued' }, 202);
    // First poll: still proving.
    mockJsonResponse<JobStatus>(
      { job_id: 'job-2', kind: 'mint', status: 'proving', phase: 'proving' },
      200,
      { 'retry-after': '0' },
    );
    // Second poll: completed with a result envelope.
    mockJsonResponse<JobStatus>({
      job_id: 'job-2',
      kind: 'mint',
      status: 'completed',
      phase: 'completed',
      result: { success: true, proof_id: 77 },
    });

    const phases: string[] = [];
    const terminal = await api.mint('abc123', undefined, {
      onPhase: (s) => phases.push(s.phase),
    });

    expect(terminal.status).toBe('completed');
    expect(terminal.result?.proof_id).toBe(77);
    // Default amount.
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).amount).toBe(10_000);
    // onPhase fired for each distinct phase.
    expect(phases).toEqual(['proving', 'completed']);
  });

  it('throws JobFailedError with the server error when the job fails', async () => {
    mockJsonResponse<JobAccepted>({ job_id: 'job-3', status: 'queued' }, 202);
    mockJsonResponse<JobStatus>({
      job_id: 'job-3',
      kind: 'mint',
      status: 'failed',
      phase: 'failed',
      error: 'mint exploded',
    });
    // `instanceof` (not a `name`-string match) so a different error
    // class carrying a copied name can never satisfy this assertion.
    const err = await api.mint('abc123').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobFailedError);
    expect((err as JobFailedError).serverError).toBe('mint exploded');
  });

  it('throws ApiError on a non-2xx admit (e.g. faucet unavailable)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve(JSON.stringify({ error: 'faucet disabled' })),
      headers: new Headers(),
    });
    await expect(api.mint('abc123')).rejects.toThrow(ApiError);
  });

  it('throws JobFailedError on a cancelled job', async () => {
    mockJsonResponse<JobAccepted>({ job_id: 'job-c', status: 'queued' }, 202);
    mockJsonResponse<JobStatus>({
      job_id: 'job-c',
      kind: 'mint',
      status: 'cancelled',
      phase: 'cancelled',
    });
    await expect(api.mint('abc123')).rejects.toThrow(/cancelled/);
  });
});

describe('api.send (lifecycle)', () => {
  const SEND_PARAMS = {
    account_address: 'aa'.repeat(32),
    recipient: 'bb'.repeat(32),
    amount: 1000,
    xpriv: 'xprv_test',
  };

  it('hydrates num_sends, signs, admits, commits, and polls to completed', async () => {
    // 1. balance hydration (num_sends = 2 → prev_commitment_pubkey set).
    mockJsonResponse<z.infer<typeof BalanceResponseSchema>>({ balance: 50_000, num_sends: 2 });
    // 2. send admit.
    mockJsonResponse<JobAccepted>({ job_id: 'send-1', status: 'queued' }, 202);
    // 3. poll → awaiting_signature with proof_id + result (node #195 shape).
    mockJsonResponse<JobStatus>({
      job_id: 'send-1',
      kind: 'send',
      status: 'awaiting_signature',
      phase: 'awaiting_signature',
      proof_id: 99,
      result: { success: true, account_state_hash: 'abc', output_coins_root: 'def' },
    });
    // 4. commit accept (partial body, parsed leniently).
    mockJsonResponse({ status: 'broadcasting' });
    // 5. poll → completed.
    mockJsonResponse<JobStatus>({
      job_id: 'send-1',
      kind: 'send',
      status: 'completed',
      phase: 'completed',
      result: { success: true, proof_id: 99 },
    });

    const result = await api.send(SEND_PARAMS);
    expect(result.status).toBe('completed');
    expect(result.result?.proof_id).toBe(99);

    // The send admit body carries the signed request shape.
    const sendCall = mockFetch.mock.calls.find(([u]) => String(u).endsWith('/api/jobs/send'));
    const sendBody = JSON.parse(sendCall![1].body);
    expect(sendBody.account_address).toBe(SEND_PARAMS.account_address);
    expect(sendBody.recipient).toBe(SEND_PARAMS.recipient);
    expect(sendBody.amount).toBe(1000);
    expect(typeof sendBody.signature).toBe('string');
    expect(typeof sendBody.timestamp).toBe('number');
    // num_sends = 2 → prev pubkey derived.
    expect(sendBody.prev_commitment_pubkey).toBeDefined();
    // Idempotency-Key present on the admit.
    expect((sendCall![1].headers as Record<string, string>)['Idempotency-Key']).toBeDefined();

    // The commit body echoes the proof_id and the WASM commitment.
    const commitCall = mockFetch.mock.calls.find(([u]) => String(u).includes('/commit'));
    const commitBody = JSON.parse(commitCall![1].body);
    expect(commitBody.proof_id).toBe(99);
    expect(commitBody.public_key).toBeDefined();
    expect(commitBody.signature).toBeDefined();
    expect(commitBody.message).toBeDefined();
  });

  it('omits prev_commitment_pubkey for a first-ever send (num_sends = 0)', async () => {
    mockJsonResponse<z.infer<typeof BalanceResponseSchema>>({ balance: 50_000, num_sends: 0 });
    mockJsonResponse<JobAccepted>({ job_id: 'send-2', status: 'queued' }, 202);
    mockJsonResponse<JobStatus>({
      job_id: 'send-2',
      kind: 'send',
      status: 'awaiting_signature',
      phase: 'awaiting_signature',
      proof_id: 1,
      result: { success: true, account_state_hash: 'a', output_coins_root: 'b' },
    });
    mockJsonResponse({ status: 'broadcasting' });
    mockJsonResponse<JobStatus>({
      job_id: 'send-2',
      kind: 'send',
      status: 'completed',
      phase: 'completed',
      result: { success: true, proof_id: 1 },
    });

    await api.send(SEND_PARAMS);
    const sendBody = JSON.parse(
      mockFetch.mock.calls.find(([u]) => String(u).endsWith('/api/jobs/send'))![1].body,
    );
    expect(sendBody.prev_commitment_pubkey).toBeUndefined();
  });

  it('hard-fails (no fabricated commitment) when ash/ocr are missing from the result', async () => {
    mockJsonResponse<z.infer<typeof BalanceResponseSchema>>({ balance: 50_000, num_sends: 0 });
    mockJsonResponse<JobAccepted>({ job_id: 'send-3', status: 'queued' }, 202);
    // awaiting_signature WITHOUT account_state_hash / output_coins_root —
    // the pre-#195 node shape. The wallet must refuse to commit.
    mockJsonResponse<JobStatus>({
      job_id: 'send-3',
      kind: 'send',
      status: 'awaiting_signature',
      phase: 'awaiting_signature',
      proof_id: 5,
    });

    const err = await api.send(SEND_PARAMS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobFailedError);
    expect((err as JobFailedError).serverError).toContain('account_state_hash');
    // No /commit call was made.
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes('/commit'))).toBe(false);
  });

  it('throws when awaiting_signature carries no proof_id', async () => {
    mockJsonResponse<z.infer<typeof BalanceResponseSchema>>({ balance: 50_000, num_sends: 0 });
    mockJsonResponse<JobAccepted>({ job_id: 'send-4', status: 'queued' }, 202);
    mockJsonResponse<JobStatus>({
      job_id: 'send-4',
      kind: 'send',
      status: 'awaiting_signature',
      phase: 'awaiting_signature',
      result: { success: true, account_state_hash: 'a', output_coins_root: 'b' },
    });
    await expect(api.send(SEND_PARAMS)).rejects.toThrow(/did not carry a proof_id/);
  });

  it('throws JobFailedError when the send job fails during proving', async () => {
    mockJsonResponse<z.infer<typeof BalanceResponseSchema>>({ balance: 50_000, num_sends: 0 });
    mockJsonResponse<JobAccepted>({ job_id: 'send-5', status: 'queued' }, 202);
    mockJsonResponse<JobStatus>({
      job_id: 'send-5',
      kind: 'send',
      status: 'failed',
      phase: 'failed',
      error: 'prove failed',
    });
    await expect(api.send(SEND_PARAMS)).rejects.toThrow(/prove failed/);
  });

  it('throws when the send job completes before commit (no awaiting_signature)', async () => {
    mockJsonResponse<z.infer<typeof BalanceResponseSchema>>({ balance: 50_000, num_sends: 0 });
    mockJsonResponse<JobAccepted>({ job_id: 'send-6', status: 'queued' }, 202);
    // Reaches a terminal `completed` before awaiting_signature — the
    // unexpected-completion guard fires.
    mockJsonResponse<JobStatus>({
      job_id: 'send-6',
      kind: 'send',
      status: 'completed',
      phase: 'completed',
      result: { success: true, proof_id: 1 },
    });
    await expect(api.send(SEND_PARAMS)).rejects.toThrow(/before commit/);
  });
});

describe('api.waitForJob retry backoff', () => {
  it('honours the Retry-After header floor before re-polling', async () => {
    vi.useFakeTimers();
    mockJsonResponse<JobStatus>(
      { job_id: 'w-1', kind: 'mint', status: 'proving', phase: 'proving' },
      200,
      { 'retry-after': '2' },
    );
    mockJsonResponse<JobStatus>({
      job_id: 'w-1',
      kind: 'mint',
      status: 'completed',
      phase: 'completed',
      result: { success: true },
    });

    const promise = api.waitForJob('w-1', new Set(['completed', 'failed', 'cancelled']));
    // First poll resolves, then a 2 s wait (Retry-After) before the second poll.
    await vi.advanceTimersByTimeAsync(2_000);
    const job = await promise;
    expect(job.status).toBe('completed');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a malformed Retry-After and falls back to the poll floor', async () => {
    vi.useFakeTimers();
    mockJsonResponse<JobStatus>(
      { job_id: 'w-2', kind: 'mint', status: 'proving', phase: 'proving' },
      200,
      { 'retry-after': 'not-a-number' },
    );
    mockJsonResponse<JobStatus>({
      job_id: 'w-2',
      kind: 'mint',
      status: 'completed',
      phase: 'completed',
    });

    const promise = api.waitForJob('w-2', new Set(['completed', 'failed', 'cancelled']));
    await vi.advanceTimersByTimeAsync(1_500);
    const job = await promise;
    expect(job.status).toBe('completed');
  });
});

describe('api.getJob', () => {
  it('returns the parsed job status', async () => {
    mockJsonResponse<JobStatus>({ job_id: 'g-1', kind: 'send', status: 'queued', phase: 'queued' });
    const job = await api.getJob('g-1');
    expect(job.status).toBe('queued');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/jobs/g-1',
      expect.any(Object),
    );
  });
});

describe('api.commitJob', () => {
  it('POSTs the commit body and tolerates a partial accept envelope', async () => {
    mockJsonResponse({ status: 'broadcasting' });
    await api.commitJob('c-1', {
      proof_id: 1,
      public_key: 'pk',
      signature: 'sig',
      message: 'msg',
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.zkcoins.app/api/jobs/c-1/commit');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).proof_id).toBe(1);
  });

  it('tolerates an empty 2xx body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      headers: new Headers(),
    });
    await expect(
      api.commitJob('c-2', { proof_id: 1, public_key: 'pk', signature: 'sig', message: 'm' }),
    ).resolves.toBeUndefined();
  });
});

describe('api.balance', () => {
  it('sends GET to /api/balance with address query param', async () => {
    mockJsonResponse<z.infer<typeof BalanceResponseSchema>>({ balance: 42000, num_sends: 0 });
    const result = await api.balance('myaddress');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/balance?address=myaddress',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
    expect(result.balance).toBe(42000);
  });

  it('returns balance: 0 for unobserved addresses (200 OK)', async () => {
    mockJsonResponse<z.infer<typeof BalanceResponseSchema>>({ balance: 0, num_sends: 0 });
    const result = await api.balance('unobserved-address');
    expect(result.balance).toBe(0);
  });

  it('throws on server errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve(JSON.stringify({ error: 'server down' })),
      headers: new Headers(),
    });
    await expect(api.balance('any')).rejects.toThrow(/API error 500/);
  });
});

describe('api.info', () => {
  it('sends GET to /api/info and returns both network and username_domain', async () => {
    mockJsonResponse<z.infer<typeof InfoResponseSchema>>({
      network: 'Mutinynet',
      username_domain: 'dev.zkcoins.app',
    });
    const result = await api.info();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/info',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
    expect(result.network).toBe('Mutinynet');
    expect(result.username_domain).toBe('dev.zkcoins.app');
  });

  it('parses the capabilities object when the server includes it', async () => {
    mockJsonResponse<z.infer<typeof InfoResponseSchema>>({
      network: 'Mutinynet',
      capabilities: { address_list: true, username_claim: true, lnurl: false, multi_asset: false },
    });
    const result = await api.info();
    expect(result.capabilities).toEqual({
      address_list: true,
      username_claim: true,
      lnurl: false,
      multi_asset: false,
    });
  });

  it('leaves capabilities undefined when the server omits the field (pre-#29 compat)', async () => {
    mockJsonResponse<z.infer<typeof InfoResponseSchema>>({ network: 'Mainnet' });
    const result = await api.info();
    expect(result.capabilities).toBeUndefined();
  });

  it('parses the normalised bitcoin_network enum when the node includes it', async () => {
    mockJsonResponse<z.infer<typeof InfoResponseSchema>>({
      network: 'Mainnet',
      bitcoin_network: 'mainnet',
    });
    const result = await api.info();
    expect(result.bitcoin_network).toBe('mainnet');
  });

  it('leaves bitcoin_network undefined when the node omits it (pre-#193 compat)', async () => {
    mockJsonResponse<z.infer<typeof InfoResponseSchema>>({ network: 'Mutinynet' });
    const result = await api.info();
    expect(result.bitcoin_network).toBeUndefined();
  });

  it('rejects a bitcoin_network value outside the enum (server drift)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ network: 'Signet', bitcoin_network: 'signet' }),
      text: () => Promise.resolve('{"network":"Signet","bitcoin_network":"signet"}'),
      headers: new Headers(),
    });
    await expect(api.info()).rejects.toThrow();
  });
});

describe('error handling', () => {
  it('throws on non-ok response (raw text body)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
      headers: new Headers(),
    });
    await expect(api.info()).rejects.toThrow('API error 500: Internal Server Error');
  });

  it('throws on 422 validation error (raw text body)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: () => Promise.resolve('Missing field: address'),
      headers: new Headers(),
    });
    await expect(api.balance('bad')).rejects.toThrow('API error 422: Missing field: address');
  });

  it('throws on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    await expect(api.info()).rejects.toThrow('Network error');
  });

  it('throws on schema mismatch (server drift)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ networkName: 'Mutinynet' }),
      text: () => Promise.resolve('{"networkName":"Mutinynet"}'),
      headers: new Headers(),
    });
    await expect(api.info()).rejects.toThrow();
  });
});

describe('ApiError (structured failure contract)', () => {
  function mockErrorResponse(status: number, error: string): void {
    const body = JSON.stringify({ error });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
      json: () => Promise.resolve(JSON.parse(body)),
      text: () => Promise.resolve(body),
      headers: new Headers(),
    });
  }

  it('throws a typed ApiError with status + serverError for a structured 422', async () => {
    mockErrorResponse(422, 'Insufficient funds');
    try {
      await api.mintJob({ account_address: 'a', amount: 1 }, 'k');
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(422);
      expect(apiErr.serverError).toBe('Insufficient funds');
      expect(apiErr.rawBody).toContain('Insufficient funds');
      expect(apiErr.message).toBe('zkCoins API error 422: Insufficient funds');
    }
  });

  it('preserves the raw body when the response body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: () => Promise.resolve('Bad Gateway'),
      headers: new Headers(),
    });
    try {
      await api.info();
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(502);
      expect(apiErr.serverError).toBe('Bad Gateway');
      expect(apiErr.rawBody).toBe('Bad Gateway');
    }
  });

  // Lockstep round-trip: every server-side `error` string in
  // KNOWN_SERVER_ERRORS must survive the fetch→ApiError translation
  // unchanged so the user-facing mapping in `errorMessages.ts` can look
  // it up by exact-string match.
  it.each(KNOWN_SERVER_ERRORS)(
    'produces ApiError.serverError === %j for the matching server response',
    async (errString) => {
      mockErrorResponse(422, errString);
      try {
        await api.info();
        throw new Error('did not throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).serverError).toBe(errString);
      }
    },
  );
});

describe('api url from store', () => {
  it('uses apiUrl from network store', async () => {
    useNetworkStore.setState({ apiUrl: 'https://custom-api.example.com' });
    mockJsonResponse<z.infer<typeof InfoResponseSchema>>({
      network: 'test',
      username_domain: 'test.zkcoins.app',
    });
    await api.info();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom-api.example.com/api/info',
      expect.any(Object),
    );
  });
});
