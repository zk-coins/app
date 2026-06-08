import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ApiError,
  JobFailedError,
  api,
  newIdempotencyKey,
  buildMintMessage,
  BalanceResponseSchema,
  OwnerBalanceResponseSchema,
  type OwnerBalanceResponse,
} from '@/lib/api/client';
import { KNOWN_SERVER_ERRORS } from '@/lib/api/errorMessages';
import { InfoResponseSchema } from '@zkcoins/sdk';
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

function mockJsonResponse<T>(data: T, status = 200, headers: Record<string, string> = {}): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(headers),
  });
}

interface JobAccepted {
  job_id: string;
  status: string;
}
interface JobStatus {
  job_id?: string;
  kind?: string;
  status: string;
  phase: string;
  proof_id?: number;
  result?: {
    success?: boolean;
    proof_id?: number;
    account_state_hash?: string;
    output_coins_root?: string;
  };
  error?: string;
}

describe('newIdempotencyKey', () => {
  it('produces an RFC-4122 v4 UUID', () => {
    expect(newIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it('is unique across calls', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('buildMintMessage byte layout', () => {
  const PUBKEY = '02' + 'ab'.repeat(32); // 33 bytes, 66 hex chars

  it('concatenates creator_pubkey ‖ name ‖ decimals ‖ amount_le ‖ ts_le', () => {
    const bytes = buildMintMessage({
      creatorPubkey: PUBKEY,
      name: 'AB', // 2 UTF-8 bytes
      decimals: 8,
      amount: 1,
      timestamp: 0,
    });
    // 33 (pubkey) + 2 (name) + 1 (decimals) + 8 (amount) + 8 (ts) = 52
    expect(bytes.length).toBe(52);
    // decimals byte sits right after the 33-byte pubkey + 2-byte name.
    expect(bytes[35]).toBe(8);
    // amount LE64: 1 → 0x01 at offset 36, rest zero.
    expect(bytes[36]).toBe(1);
    expect(bytes[37]).toBe(0);
  });

  it('throws on a non-33-byte creator pubkey', () => {
    expect(() =>
      buildMintMessage({ creatorPubkey: 'aa', name: 'x', decimals: 0, amount: 1, timestamp: 0 }),
    ).toThrow(/33-byte/);
  });

  it('throws on out-of-range decimals', () => {
    expect(() =>
      buildMintMessage({
        creatorPubkey: PUBKEY,
        name: 'x',
        decimals: 999,
        amount: 1,
        timestamp: 0,
      }),
    ).toThrow(/decimals/);
  });

  it('throws on odd-length hex', () => {
    expect(() =>
      buildMintMessage({
        creatorPubkey: PUBKEY.slice(0, 65),
        name: 'x',
        decimals: 0,
        amount: 1,
        timestamp: 0,
      }),
    ).toThrow();
  });

  it('throws on even-length but non-hex characters', () => {
    expect(() =>
      buildMintMessage({
        creatorPubkey: 'gg'.repeat(33),
        name: 'x',
        decimals: 0,
        amount: 1,
        timestamp: 0,
      }),
    ).toThrow(/invalid hex/);
  });

  it('throws on an amount beyond u64', () => {
    expect(() =>
      buildMintMessage({
        creatorPubkey: PUBKEY,
        name: 'x',
        decimals: 0,
        amount: Number.MAX_SAFE_INTEGER * 1e6,
        timestamp: 0,
      }),
    ).toThrow();
  });
});

describe('api.mintJob', () => {
  it('POSTs /api/jobs/mint with the creator-signed body + Idempotency-Key header', async () => {
    mockJsonResponse<JobAccepted>({ job_id: 'job-1', status: 'queued' }, 202);
    const accepted = await api.mintJob(
      {
        creator_pubkey: '02' + 'aa'.repeat(32),
        name: 'Coin',
        decimals: 2,
        amount: 1000,
        next_public_key: '02' + 'bb'.repeat(32),
        signature: 'sig',
        timestamp: 1700000000,
      },
      'idem-1',
    );
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.zkcoins.app/api/jobs/mint');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-1');
    const body = JSON.parse(init.body);
    expect(body.creator_pubkey).toBe('02' + 'aa'.repeat(32));
    expect(body.name).toBe('Coin');
    expect(accepted.job_id).toBe('job-1');
  });
});

describe('api.sendJob', () => {
  it('POSTs /api/jobs/send with asset_id + Idempotency-Key', async () => {
    mockJsonResponse<JobAccepted>({ job_id: 'send-admit', status: 'queued' }, 202);
    const accepted = await api.sendJob(
      {
        account_address: 'aa'.repeat(32),
        recipient: 'bb'.repeat(32),
        amount: 1000,
        asset_id: 'cc'.repeat(32),
        public_key: 'pk',
        next_public_key: 'npk',
        signature: 'sig',
        timestamp: 1700000000,
      },
      'idem-send-1',
    );
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.zkcoins.app/api/jobs/send');
    expect(JSON.parse(init.body).asset_id).toBe('cc'.repeat(32));
    expect(accepted.job_id).toBe('send-admit');
  });
});

describe('api.createCoin (lifecycle)', () => {
  const PARAMS = {
    account_address: 'aa'.repeat(32),
    name: 'MyCoin',
    decimals: 2,
    amount: 1000,
    xpriv: 'xprv_test',
  };

  it('signs the mint, admits, commits, and polls to completed', async () => {
    // 1. mint admit
    mockJsonResponse<JobAccepted>({ job_id: 'mint-1', status: 'queued' }, 202);
    // 2. poll → awaiting_signature with ash/ocr (node #195 shape)
    mockJsonResponse<JobStatus>({
      job_id: 'mint-1',
      kind: 'mint',
      status: 'awaiting_signature',
      phase: 'awaiting_signature',
      proof_id: 7,
      result: { account_state_hash: 'abc', output_coins_root: 'def' },
    });
    // 3. commit accept
    mockJsonResponse({ status: 'broadcasting' });
    // 4. poll → completed
    mockJsonResponse<JobStatus>({
      job_id: 'mint-1',
      kind: 'mint',
      status: 'completed',
      phase: 'completed',
      result: { success: true, proof_id: 7 },
    });

    const phases: string[] = [];
    const terminal = await api.createCoin(PARAMS, { onPhase: (s) => phases.push(s.phase) });
    expect(terminal.status).toBe('completed');

    const mintCall = mockFetch.mock.calls.find(([u]) => String(u).endsWith('/api/jobs/mint'));
    const mintBody = JSON.parse(mintCall![1].body);
    expect(mintBody.name).toBe('MyCoin');
    expect(mintBody.decimals).toBe(2);
    expect(typeof mintBody.signature).toBe('string');
    expect(typeof mintBody.creator_pubkey).toBe('string');

    const commitCall = mockFetch.mock.calls.find(([u]) => String(u).includes('/commit'));
    expect(JSON.parse(commitCall![1].body).proof_id).toBe(7);
    expect(phases).toContain('awaiting_signature');
  });

  it('throws JobFailedError when the mint job fails', async () => {
    mockJsonResponse<JobAccepted>({ job_id: 'mint-2', status: 'queued' }, 202);
    mockJsonResponse<JobStatus>({
      job_id: 'mint-2',
      kind: 'mint',
      status: 'failed',
      phase: 'failed',
      error: 'mint exploded',
    });
    const err = await api.createCoin(PARAMS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobFailedError);
    expect((err as JobFailedError).serverError).toBe('mint exploded');
  });

  it('throws ApiError on a non-2xx admit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: () => Promise.resolve(JSON.stringify({ error: 'bad name' })),
      headers: new Headers(),
    });
    await expect(api.createCoin(PARAMS)).rejects.toThrow(ApiError);
  });

  it('hard-fails when awaiting_signature carries no ash/ocr', async () => {
    mockJsonResponse<JobAccepted>({ job_id: 'mint-3', status: 'queued' }, 202);
    mockJsonResponse<JobStatus>({
      job_id: 'mint-3',
      kind: 'mint',
      status: 'awaiting_signature',
      phase: 'awaiting_signature',
      proof_id: 1,
    });
    const err = await api.createCoin(PARAMS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobFailedError);
    expect((err as JobFailedError).serverError).toContain('account_state_hash');
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes('/commit'))).toBe(false);
  });

  it('throws when awaiting_signature carries no proof_id', async () => {
    mockJsonResponse<JobAccepted>({ job_id: 'mint-4', status: 'queued' }, 202);
    mockJsonResponse<JobStatus>({
      job_id: 'mint-4',
      kind: 'mint',
      status: 'awaiting_signature',
      phase: 'awaiting_signature',
      result: { account_state_hash: 'a', output_coins_root: 'b' },
    });
    await expect(api.createCoin(PARAMS)).rejects.toThrow(/did not carry a proof_id/);
  });

  it('throws when the mint completes before commit', async () => {
    mockJsonResponse<JobAccepted>({ job_id: 'mint-5', status: 'queued' }, 202);
    mockJsonResponse<JobStatus>({
      job_id: 'mint-5',
      kind: 'mint',
      status: 'completed',
      phase: 'completed',
      result: { success: true, proof_id: 1 },
    });
    await expect(api.createCoin(PARAMS)).rejects.toThrow(/before commit/);
  });
});

describe('api.send (lifecycle)', () => {
  const ASSET = 'cc'.repeat(32);
  const SEND_PARAMS = {
    account_address: 'aa'.repeat(32),
    recipient: 'bb'.repeat(32),
    amount: 1000,
    asset_id: ASSET,
    xpriv: 'xprv_test',
  };

  function mockOwner(over: Partial<OwnerBalanceResponse> = {}): void {
    mockJsonResponse<OwnerBalanceResponse>({
      address: 'aa'.repeat(32),
      assets: [{ asset_id: ASSET, balance: 50_000, num_sends: 2 }],
      ...over,
    });
  }

  it('hydrates the index from summed num_sends, signs, admits, commits, polls', async () => {
    mockOwner(); // num_sends total = 2 → prev pubkey set
    mockJsonResponse<JobAccepted>({ job_id: 'send-1', status: 'queued' }, 202);
    mockJsonResponse<JobStatus>({
      job_id: 'send-1',
      kind: 'send',
      status: 'awaiting_signature',
      phase: 'awaiting_signature',
      proof_id: 99,
      result: { account_state_hash: 'abc', output_coins_root: 'def' },
    });
    mockJsonResponse({ status: 'broadcasting' });
    mockJsonResponse<JobStatus>({
      job_id: 'send-1',
      kind: 'send',
      status: 'completed',
      phase: 'completed',
      result: { success: true, proof_id: 99 },
    });

    const result = await api.send(SEND_PARAMS);
    expect(result.status).toBe('completed');

    const sendCall = mockFetch.mock.calls.find(([u]) => String(u).endsWith('/api/jobs/send'));
    const sendBody = JSON.parse(sendCall![1].body);
    expect(sendBody.asset_id).toBe(ASSET);
    expect(sendBody.amount).toBe(1000);
    expect(sendBody.prev_commitment_pubkey).toBeDefined();
    expect(typeof sendBody.signature).toBe('string');
  });

  it('omits prev_commitment_pubkey when the wallet has never sent', async () => {
    mockOwner({ assets: [{ asset_id: ASSET, balance: 50_000, num_sends: 0 }] });
    mockJsonResponse<JobAccepted>({ job_id: 'send-2', status: 'queued' }, 202);
    mockJsonResponse<JobStatus>({
      job_id: 'send-2',
      kind: 'send',
      status: 'awaiting_signature',
      phase: 'awaiting_signature',
      proof_id: 1,
      result: { account_state_hash: 'a', output_coins_root: 'b' },
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

  it('refuses to send more than the asset balance', async () => {
    mockOwner({ assets: [{ asset_id: ASSET, balance: 500, num_sends: 0 }] });
    const err = await api.send(SEND_PARAMS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).serverError).toBe('Insufficient funds');
    // No admit was attempted.
    expect(mockFetch.mock.calls.some(([u]) => String(u).endsWith('/api/jobs/send'))).toBe(false);
  });

  it('treats a not-held asset as zero balance', async () => {
    mockOwner({ assets: [] });
    await expect(api.send(SEND_PARAMS)).rejects.toThrow(ApiError);
  });

  it('hard-fails when ash/ocr are missing', async () => {
    mockOwner({ assets: [{ asset_id: ASSET, balance: 50_000, num_sends: 0 }] });
    mockJsonResponse<JobAccepted>({ job_id: 'send-3', status: 'queued' }, 202);
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
  });

  it('throws when awaiting_signature carries no proof_id', async () => {
    mockOwner({ assets: [{ asset_id: ASSET, balance: 50_000, num_sends: 0 }] });
    mockJsonResponse<JobAccepted>({ job_id: 'send-4', status: 'queued' }, 202);
    mockJsonResponse<JobStatus>({
      job_id: 'send-4',
      kind: 'send',
      status: 'awaiting_signature',
      phase: 'awaiting_signature',
      result: { account_state_hash: 'a', output_coins_root: 'b' },
    });
    await expect(api.send(SEND_PARAMS)).rejects.toThrow(/did not carry a proof_id/);
  });

  it('throws JobFailedError when the send job fails during proving', async () => {
    mockOwner({ assets: [{ asset_id: ASSET, balance: 50_000, num_sends: 0 }] });
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

  it('throws when the send completes before commit', async () => {
    mockOwner({ assets: [{ asset_id: ASSET, balance: 50_000, num_sends: 0 }] });
    mockJsonResponse<JobAccepted>({ job_id: 'send-6', status: 'queued' }, 202);
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
    expect((await promise).status).toBe('completed');
  });

  it('throws JobFailedError on a cancelled job', async () => {
    mockJsonResponse<JobStatus>({
      job_id: 'w-3',
      kind: 'mint',
      status: 'cancelled',
      phase: 'cancelled',
    });
    await expect(api.waitForJob('w-3', new Set(['completed']))).rejects.toThrow(/cancelled/);
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
    await api.commitJob('c-1', { proof_id: 1, public_key: 'pk', signature: 'sig', message: 'msg' });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.zkcoins.app/api/jobs/c-1/commit');
    expect(JSON.parse(init.body).proof_id).toBe(1);
  });
});

describe('api.balance (per-asset)', () => {
  it('GETs /api/balance with address + asset_id query params', async () => {
    mockJsonResponse({ balance: 42000, num_sends: 0 });
    const result = await api.balance('myaddr', 'asset123');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://test-api.zkcoins.app/api/balance?address=myaddr&asset_id=asset123');
    expect(result.balance).toBe(42000);
    expect(() => BalanceResponseSchema.parse(result)).not.toThrow();
  });

  it('throws ApiError on a server error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: () => Promise.resolve(JSON.stringify({ error: 'asset_id required' })),
      headers: new Headers(),
    });
    const err = await api.balance('a', 'b').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).serverError).toBe('asset_id required');
  });
});

describe('api.ownerBalances (portfolio)', () => {
  it('GETs /api/balance/:address and parses the portfolio', async () => {
    mockJsonResponse<OwnerBalanceResponse>({
      address: 'addr',
      assets: [{ asset_id: 'x'.repeat(64), name: 'X', decimals: 0, balance: 5, num_sends: 1 }],
    });
    const res = await api.ownerBalances('addr');
    expect(mockFetch.mock.calls[0][0]).toBe('https://test-api.zkcoins.app/api/balance/addr');
    expect(res.assets).toHaveLength(1);
    expect(() => OwnerBalanceResponseSchema.parse(res)).not.toThrow();
  });

  it('parses an empty portfolio for an unobserved address', async () => {
    mockJsonResponse<OwnerBalanceResponse>({ address: 'unseen', assets: [] });
    const res = await api.ownerBalances('unseen');
    expect(res.assets).toEqual([]);
  });

  it('throws ApiError when the node errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('down'),
      headers: new Headers(),
    });
    await expect(api.ownerBalances('a')).rejects.toThrow(ApiError);
  });
});

describe('api.info', () => {
  it('GETs /api/info and parses the response', async () => {
    mockJsonResponse({ network: 'Mutinynet', username_domain: 'local.zkcoins.test' });
    const result = await api.info();
    expect(result.network).toBe('Mutinynet');
    expect(() => InfoResponseSchema.parse(result)).not.toThrow();
  });
});

describe('ApiError contract (lockstep round-trip)', () => {
  it.each(KNOWN_SERVER_ERRORS)(
    'produces ApiError.serverError === %j for the matching server response',
    async (errString) => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: () => Promise.resolve(JSON.stringify({ error: errString })),
        headers: new Headers(),
      });
      const err = await api.ownerBalances('a').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).serverError).toBe(errString);
    },
  );

  it('preserves the raw body when not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: () => Promise.resolve('Bad Gateway'),
      headers: new Headers(),
    });
    const err = await api.ownerBalances('a').catch((e: unknown) => e);
    expect((err as ApiError).serverError).toBe('Bad Gateway');
  });
});

describe('api url from store', () => {
  it('uses apiUrl from network store', async () => {
    useNetworkStore.setState({ apiUrl: 'https://custom-api.example.com' });
    mockJsonResponse<OwnerBalanceResponse>({ address: 'a', assets: [] });
    await api.ownerBalances('a');
    expect(mockFetch.mock.calls[0][0]).toBe('https://custom-api.example.com/api/balance/a');
  });
});
