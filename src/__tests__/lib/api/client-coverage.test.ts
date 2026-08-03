/**
 * Fills remaining `src/lib/api/client.ts` coverage gaps with real execution
 * of the thin-adapter paths (handshake, history, fail-closed reads, mapV1Error).
 * Network hops are stubbed on `ZkCoinsV1Client` prototypes — crypto signing is
 * not exercised; custody refusals stay mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZkCoinsV1Client, V1ApiError, type DeliveryCredential, type V1Job } from '@zkcoins/sdk';
import {
  ApiError,
  JobFailedError,
  api,
  historyItemDate,
  newIdempotencyKey,
} from '@/lib/api/client';
import { useNetworkStore } from '@/stores/network';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ADDR = 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const NK = '00'.repeat(32);
const JOB_ID = 'job-cover-1';

const invoiceDelivery: DeliveryCredential = {
  type: 'invoice',
  invoice: {
    amount: '1',
    recipient: ADDR,
    asset_id: 'aa'.repeat(32),
    pk0: 'bb'.repeat(32),
    nk_commit: 'cc'.repeat(32),
    ivpk: 'dd'.repeat(32),
    op_pubkey: 'ee'.repeat(32),
    relays: ['wss://r.example'],
    addr_sig: '11'.repeat(64),
    sig: '22'.repeat(64),
  },
};

function completedJob(overrides: Partial<V1Job> = {}): V1Job {
  return {
    job_id: JOB_ID,
    kind: 'mint',
    status: 'completed',
    phase: 'completed',
    progress: 1,
    ...overrides,
  } as V1Job;
}

function awaitingJob(overrides: Partial<V1Job> = {}): V1Job {
  return {
    job_id: JOB_ID,
    kind: 'mint',
    status: 'awaiting_signature',
    phase: 'awaiting_signature',
    progress: 0.5,
    awaiting_signature: {
      send_counter: 0,
      m_state: '00'.repeat(32),
      proof_data_hash: '11'.repeat(32),
      npk_commit: '22'.repeat(32),
      network: 'regtest',
    },
    ...overrides,
  } as V1Job;
}

const spies: Array<ReturnType<typeof vi.spyOn>> = [];

function spyProto<K extends keyof ZkCoinsV1Client>(
  method: K,
  impl: ZkCoinsV1Client[K],
): ReturnType<typeof vi.spyOn> {
  const s = vi.spyOn(ZkCoinsV1Client.prototype, method).mockImplementation(impl as never);
  spies.push(s);
  return s;
}

function mockHappyHandshake(opts: { sendCounter?: number; phases?: string[] } = {}) {
  const sendCounter = opts.sendCounter ?? 0;
  spyProto('openOwnershipPullSession', async () => ({
    session: 'pull-sess',
    records: [],
    head: { send_counter: sendCounter, current_pubkey: 'aa'.repeat(32) },
  }));
  spyProto('getAccountState', async () => ({
    send_counter: sendCounter,
    current_pubkey: 'aa'.repeat(32),
  }));
  spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
  spyProto('waitForAwaitingSignature', async () =>
    awaitingJob({
      awaiting_signature: {
        send_counter: sendCounter,
        m_state: '00'.repeat(32),
        proof_data_hash: '11'.repeat(32),
        npk_commit: '22'.repeat(32),
        network: 'regtest',
      },
    } as Partial<V1Job>),
  );
  spyProto('refuseOrSignAndSubmit', async () => ({
    signature: { signature: '33'.repeat(64), s2c_nonce: '44'.repeat(32) } as never,
    job: completedJob({ phase: 'signed' }),
  }));

  let getJobCalls = 0;
  const phases = opts.phases ?? ['proving', 'completed'];
  spyProto('getJob', async () => {
    const phase = phases[Math.min(getJobCalls, phases.length - 1)]!;
    getJobCalls += 1;
    if (phase === 'completed') {
      return { job: completedJob({ phase }), retryAfterMs: null };
    }
    return {
      job: {
        ...completedJob({ status: 'running', phase }),
        status: 'running',
      } as V1Job,
      retryAfterMs: 10,
    };
  });
}

beforeEach(() => {
  useNetworkStore.setState({
    apiUrl: 'https://test-api.zkcoins.app',
    network: 'regtest',
    infoError: null,
    infoLoaded: true,
  });
});

afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('historyItemDate', () => {
  it('parses unix seconds and milliseconds as numbers', () => {
    expect(historyItemDate({ created_at: 1_700_000_000 }).getTime()).toBe(1_700_000_000_000);
    expect(historyItemDate({ created_at: 1_700_000_000_000 }).getTime()).toBe(1_700_000_000_000);
  });

  it('parses numeric strings (seconds and ms) and ISO strings', () => {
    expect(historyItemDate({ created_at: '1700000000' }).getTime()).toBe(1_700_000_000_000);
    expect(historyItemDate({ created_at: '1700000000000' }).getTime()).toBe(1_700_000_000_000);
    expect(historyItemDate({ created_at: '2024-01-15T12:00:00.000Z' }).toISOString()).toBe(
      '2024-01-15T12:00:00.000Z',
    );
  });

  it('returns Invalid Date for empty/missing values', () => {
    expect(Number.isNaN(historyItemDate({ created_at: '' }).getTime())).toBe(true);
    expect(
      Number.isNaN(historyItemDate({ created_at: undefined as unknown as string }).getTime()),
    ).toBe(true);
  });
});

describe('ApiError / JobFailedError fallback messages', () => {
  it('ApiError falls back to HTTP status text when serverError is omitted', () => {
    const e = new ApiError(503);
    expect(e.message).toBe('HTTP 503');
    expect(e.serverError).toBeUndefined();
  });

  it('JobFailedError falls back to status description', () => {
    const e = new JobFailedError('j9', 'cancelled');
    expect(e.message).toMatch(/j9.*cancelled/);
  });
});

describe('newIdempotencyKey without randomUUID', () => {
  it('fails closed when crypto.randomUUID is unavailable', () => {
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: original.getRandomValues.bind(original) });
    try {
      expect(() => newIdempotencyKey()).toThrow(/crypto\.randomUUID is unavailable/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('api.getJob / mapV1Error', () => {
  it('returns the job body on success', async () => {
    spyProto('getJob', async () => ({ job: completedJob(), retryAfterMs: null }));
    const job = await api.getJob(JOB_ID);
    expect(job.job_id).toBe(JOB_ID);
    expect(job.status).toBe('completed');
  });

  it('maps V1ApiError to ApiError', async () => {
    spyProto('getJob', async () => {
      throw new V1ApiError(502, 'bad_gateway', 'upstream');
    });
    await expect(api.getJob(JOB_ID)).rejects.toMatchObject({
      status: 502,
      serverError: 'bad_gateway',
    });
  });

  it('re-throws ApiError and JobFailedError unchanged', async () => {
    spyProto('getJob', async () => {
      throw new ApiError(418, 'teapot');
    });
    await expect(api.getJob(JOB_ID)).rejects.toMatchObject({ status: 418 });

    spyProto('getJob', async () => {
      throw new JobFailedError('j', 'failed', 'x');
    });
    await expect(api.getJob(JOB_ID)).rejects.toBeInstanceOf(JobFailedError);
  });

  it('re-throws plain Error and stringifies non-Error throws', async () => {
    spyProto('getJob', async () => {
      throw new Error('plain');
    });
    await expect(api.getJob(JOB_ID)).rejects.toThrow('plain');

    spyProto('getJob', async () => {
      throw 'raw-string';
    });
    await expect(api.getJob(JOB_ID)).rejects.toThrow('raw-string');
  });
});

describe('fail-closed balance / portfolio helpers', () => {
  it('api.balance is 501', async () => {
    await expect(api.balance(ADDR, 'aa'.repeat(32))).rejects.toMatchObject({ status: 501 });
  });
});

describe('api.accountState / getHistory / getTransaction', () => {
  it('accountState returns the pull-session head', async () => {
    spyProto('openOwnershipPullSession', async () => ({
      session: 's1',
      records: [],
    }));
    spyProto('getAccountState', async () => ({
      send_counter: 3,
      current_pubkey: 'ab'.repeat(32),
    }));
    const head = await api.accountState({ address: ADDR, mnemonic: MNEMONIC, nkCommit: NK });
    expect(head.send_counter).toBe(3);
  });

  it('accountState maps pull failures', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(401, 'unauthorized', '');
    });
    await expect(
      api.accountState({ address: ADDR, mnemonic: MNEMONIC, nkCommit: NK }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('getHistory maps pull records into UI items with limit/offset', async () => {
    spyProto('openOwnershipPullSession', async () => ({
      session: 's1',
      records: [
        {
          record_id: 'r0',
          record_type: 'coin',
          transition_kind: 'mint',
          occurred_at: '2024-01-01T00:00:00.000Z',
        },
        {
          record_id: 'r1',
          record_type: 'coin',
          transition_kind: 'send',
          occurred_at: '2024-01-02T00:00:00.000Z',
        },
        {
          record_id: 'r2',
          record_type: 'note',
          // no transition_kind — falls back to record_type
          occurred_at: 1_700_000_000,
        },
      ],
    }));
    const res = await api.getHistory(
      { address: ADDR, mnemonic: MNEMONIC, nkCommit: NK },
      { limit: 1, offset: 1 },
    );
    expect(res.total).toBe(3);
    expect(res.limit).toBe(1);
    expect(res.offset).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: 'r1',
      kind: 'send',
      status: 'completed',
      index: 1,
    });

    // Full list: transition_kind preferred, else record_type
    const all = await api.getHistory({ address: ADDR, mnemonic: MNEMONIC, nkCommit: NK });
    expect(all.items.map((i) => i.kind)).toEqual(['mint', 'send', 'note']);
  });

  it('getHistory defaults limit/offset and maps errors', async () => {
    spyProto('openOwnershipPullSession', async () => ({
      session: 's1',
      records: [],
    }));
    const empty = await api.getHistory({ address: ADDR, mnemonic: MNEMONIC, nkCommit: NK });
    expect(empty).toEqual({ items: [], total: 0, limit: 50, offset: 0 });

    spyProto('openOwnershipPullSession', async () => {
      throw new Error('pull down');
    });
    await expect(
      api.getHistory({ address: ADDR, mnemonic: MNEMONIC, nkCommit: NK }),
    ).rejects.toThrow('pull down');
  });

  it('getTransaction finds a row or 404s', async () => {
    spyProto('openOwnershipPullSession', async () => ({
      session: 's1',
      records: [
        {
          record_id: 'tx-7',
          record_type: 'coin',
          transition_kind: 'send',
          occurred_at: '2024-06-01T00:00:00.000Z',
        },
      ],
    }));
    const found = await api.getTransaction('tx-7', {
      address: ADDR,
      mnemonic: MNEMONIC,
      nkCommit: NK,
    });
    expect(found.id).toBe('tx-7');

    await expect(
      api.getTransaction('missing', { address: ADDR, mnemonic: MNEMONIC, nkCommit: NK }),
    ).rejects.toMatchObject({ status: 404, serverError: 'not_found' });
  });

  it('rejects malformed nkCommit hex fail-closed', async () => {
    await expect(
      api.accountState({ address: ADDR, mnemonic: MNEMONIC, nkCommit: 'zz' }),
    ).rejects.toThrow(/nkCommit/);
  });
});

describe('api.createCoin — account-state 404 vs live counter + handshake', () => {
  it('treats typed 404 as new account (sendCounter=0) and completes mint', async () => {
    let pullCalls = 0;
    spyProto('openOwnershipPullSession', async () => {
      pullCalls += 1;
      if (pullCalls === 1) {
        throw new V1ApiError(404, 'not_found', 'missing account');
      }
      return { session: 's-sign', records: [] };
    });
    spyProto('getAccountState', async () => ({
      send_counter: 0,
      current_pubkey: 'aa'.repeat(32),
    }));
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    // Invoke the sleep callback waitForAwaitingSignature receives (covers
    // the inline `(ms) => delay(Math.max(POLL_FLOOR_MS, ms))` arrow).
    spyProto('waitForAwaitingSignature', async (_id, opts) => {
      if (opts?.sleep) await opts.sleep(10);
      return awaitingJob();
    });
    spyProto('refuseOrSignAndSubmit', async () => ({
      signature: { signature: '33'.repeat(64), s2c_nonce: '44'.repeat(32) } as never,
      job: completedJob(),
    }));
    spyProto('getJob', async () => ({ job: completedJob(), retryAfterMs: null }));

    const phases: string[] = [];
    const job = await api.createCoin(
      {
        account_address: ADDR,
        name: 'Cover',
        decimals: 0,
        amount: 10,
        mnemonic: MNEMONIC,
        nkCommit: NK,
      },
      { onPhase: (s) => phases.push(s.phase ?? s.status) },
    );
    expect(job.status).toBe('completed');
    expect(phases.length).toBeGreaterThan(0);
  });

  it('uses live send_counter when account state is present', async () => {
    mockHappyHandshake({ sendCounter: 2, phases: ['completed'] });
    const job = await api.createCoin({
      account_address: ADDR,
      name: 'Live',
      decimals: 2,
      amount: 5,
      mnemonic: MNEMONIC,
      nkCommit: NK,
      asset_id: 'ab'.repeat(32),
      accountIndex: 0,
    });
    expect(job.status).toBe('completed');
  });

  it('mint delegates to createCoin', async () => {
    mockHappyHandshake({ phases: ['completed'] });
    // First pull for createCoin account head: mockHappy already returns send_counter 0
    const job = await api.mint({ account_address: ADDR, mnemonic: MNEMONIC, nkCommit: NK }, 42);
    expect(job.status).toBe('completed');
  });
});

describe('runTransitionHandshake error branches via createCoin', () => {
  it('throws JobFailedError when wait returns failed', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async () =>
      completedJob({
        status: 'failed',
        error: { error: 'prove_failed', message: 'circuit boom' },
      } as Partial<V1Job>),
    );

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: 1,
        mnemonic: MNEMONIC,
        nkCommit: NK,
      }),
    ).rejects.toBeInstanceOf(JobFailedError);
  });

  it('throws when job ends before signature in a non-failed terminal', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async () =>
      completedJob({ status: 'completed', awaiting_signature: undefined }),
    );

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: 1,
        mnemonic: MNEMONIC,
        nkCommit: NK,
      }),
    ).rejects.toMatchObject({ name: 'JobFailedError' });
  });

  it('throws when awaiting_signature payload is missing', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async () =>
      awaitingJob({ awaiting_signature: undefined } as Partial<V1Job>),
    );

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: 1,
        mnemonic: MNEMONIC,
        nkCommit: NK,
      }),
    ).rejects.toThrow(/awaiting_signature payload/);
  });

  it('throws JobFailedError when wait returns cancelled with error.error only', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async () =>
      completedJob({
        status: 'cancelled',
        error: { error: 'user_cancelled' },
      } as Partial<V1Job>),
    );

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: 1,
        mnemonic: MNEMONIC,
        nkCommit: NK,
      }),
    ).rejects.toBeInstanceOf(JobFailedError);
  });
});

describe('waitForJob branches via completed handshake + poll', () => {
  it('fails closed when non-terminal status lacks Retry-After', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async () => awaitingJob());
    spyProto('getAccountState', async () => ({
      send_counter: 0,
      current_pubkey: 'aa'.repeat(32),
    }));
    // After 404 path, signing pull also needs openOwnershipPullSession success.
    let pulls = 0;
    spies[0]!.mockImplementation(async () => {
      pulls += 1;
      if (pulls === 1) throw new V1ApiError(404, 'not_found', '');
      return { session: 's', records: [] };
    });
    spyProto('refuseOrSignAndSubmit', async () => ({
      signature: { signature: '33'.repeat(64), s2c_nonce: '44'.repeat(32) } as never,
      job: completedJob({ status: 'running', phase: 'proving' }),
    }));
    spyProto('getJob', async () => ({
      job: completedJob({ status: 'running', phase: 'proving' }),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: 1,
        mnemonic: MNEMONIC,
        nkCommit: NK,
      }),
    ).rejects.toThrow(/without Retry-After/);
  });

  it('throws JobFailedError on failed poll status and surfaces error.message', async () => {
    let pulls = 0;
    spyProto('openOwnershipPullSession', async () => {
      pulls += 1;
      if (pulls === 1) throw new V1ApiError(404, 'not_found', '');
      return { session: 's', records: [] };
    });
    spyProto('getAccountState', async () => ({
      send_counter: 0,
      current_pubkey: 'aa'.repeat(32),
    }));
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async () => awaitingJob());
    spyProto('refuseOrSignAndSubmit', async () => ({
      signature: { signature: '33'.repeat(64), s2c_nonce: '44'.repeat(32) } as never,
      job: completedJob({ status: 'running' }),
    }));
    spyProto('getJob', async () => ({
      job: completedJob({
        status: 'failed',
        error: { message: 'prove exploded' },
      } as Partial<V1Job>),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: 1,
        mnemonic: MNEMONIC,
        nkCommit: NK,
      }),
    ).rejects.toMatchObject({ serverError: 'prove exploded' });
  });

  it('surfaces job.error.error when message is absent on cancelled poll', async () => {
    let pulls = 0;
    spyProto('openOwnershipPullSession', async () => {
      pulls += 1;
      if (pulls === 1) throw new V1ApiError(404, 'not_found', '');
      return { session: 's', records: [] };
    });
    spyProto('getAccountState', async () => ({
      send_counter: 0,
      current_pubkey: 'aa'.repeat(32),
    }));
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async (_id, opts) => {
      if (opts?.sleep) await opts.sleep(5);
      return awaitingJob();
    });
    spyProto('refuseOrSignAndSubmit', async () => ({
      signature: { signature: '33'.repeat(64), s2c_nonce: '44'.repeat(32) } as never,
      job: completedJob({ status: 'running' }),
    }));
    spyProto('getJob', async () => ({
      job: completedJob({
        status: 'cancelled',
        error: { error: 'user_cancelled_only' },
      } as Partial<V1Job>),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: 1,
        mnemonic: MNEMONIC,
        nkCommit: NK,
      }),
    ).rejects.toMatchObject({ serverError: 'user_cancelled_only' });
  });

  it('polls with Retry-After floor and notifies phase changes', async () => {
    vi.useFakeTimers();
    let pulls = 0;
    spyProto('openOwnershipPullSession', async () => {
      pulls += 1;
      if (pulls === 1) throw new V1ApiError(404, 'not_found', '');
      return { session: 's', records: [] };
    });
    spyProto('getAccountState', async () => ({
      send_counter: 0,
      current_pubkey: 'aa'.repeat(32),
    }));
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async () => awaitingJob());
    spyProto('refuseOrSignAndSubmit', async () => ({
      signature: { signature: '33'.repeat(64), s2c_nonce: '44'.repeat(32) } as never,
      job: completedJob({ status: 'running', phase: 'proving' }),
    }));

    let poll = 0;
    spyProto('getJob', async () => {
      poll += 1;
      if (poll === 1) {
        return {
          job: completedJob({ status: 'running', phase: 'proving' }),
          retryAfterMs: 5, // below POLL_FLOOR_MS → floor applies
        };
      }
      return { job: completedJob({ phase: 'completed' }), retryAfterMs: null };
    });

    const phases: string[] = [];
    const pending = api.createCoin(
      {
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: 1,
        mnemonic: MNEMONIC,
        nkCommit: NK,
      },
      { onPhase: (j) => phases.push(String(j.phase)) },
    );

    await vi.runAllTimersAsync();
    const job = await pending;
    expect(job.status).toBe('completed');
    expect(phases).toContain('awaiting_signature');
    expect(phases).toContain('proving');
  });
});

describe('api.send failure mapping (no delivery crypto)', () => {
  it('maps send failures through mapV1Error before placeDelivery', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(500, 'internal_error', 'x');
    });
    await expect(
      api.send({
        account_address: ADDR,
        recipient: ADDR,
        amount: 1,
        asset_id: 'aa'.repeat(32),
        mnemonic: MNEMONIC,
        nkCommit: NK,
        delivery: invoiceDelivery,
        input_coins: ['ff'.repeat(32)],
      }),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe('api.info features default', () => {
  it('maps missing features to empty capability set (multi_asset still true)', async () => {
    spyProto('info', async () => ({
      network: 'regtest',
      protocol_version: 'v1',
      // features omitted
    }));
    const info = await api.info();
    expect(info.capabilities).toEqual({
      address_list: false,
      username_claim: false,
      lnurl: false,
      multi_asset: true,
    });
  });
});
