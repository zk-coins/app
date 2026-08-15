/**
 * Fills remaining `src/lib/api/client.ts` coverage gaps with real execution
 * of the thin-adapter paths (handshake, history, fail-closed reads, mapV1Error).
 * Network hops are stubbed on `ZkCoinsV1Client` prototypes — crypto signing is
 * not exercised; custody refusals stay mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ZkCoinsV1Client,
  V1ApiError,
  KeyBindingRefusalError,
  encodeHexLower,
  type DeliveryCredential,
  type V1Job,
  type V1JobErrorBody,
  type V1Info,
} from '@zkcoins/sdk';
import {
  ApiError,
  JobFailedError,
  api,
  historyItemDate,
  newIdempotencyKey,
} from '@/lib/api/client';
import { SERVER_ERROR_TO_USER_MESSAGE, userMessageFor } from '@/lib/api/errorMessages';
import { useNetworkStore } from '@/stores/network';
import { spendKeyAt } from '@/lib/crypto/account-keys';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ADDR = 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const NK = '00'.repeat(32);
const JOB_ID = 'job-cover-1';

const DUMMY_SIG = {
  signature: new Uint8Array(64),
  s2cNonce: new Uint8Array(32),
};

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

/** Overrides may supply a partial error body (defensive fallback-parsing tests). */
type JobOverrides = Omit<Partial<V1Job>, 'error'> & { error?: Partial<V1JobErrorBody> };

function completedJob(overrides: JobOverrides = {}): V1Job {
  return {
    job_id: JOB_ID,
    kind: 'mint',
    status: 'completed',
    phase: 'completed',
    progress: 1,
    ...overrides,
  } as V1Job;
}

function awaitingJob(overrides: JobOverrides = {}): V1Job {
  return {
    job_id: JOB_ID,
    kind: 'mint',
    status: 'awaiting_signature',
    phase: 'awaiting_signature',
    progress: 0.5,
    awaiting_signature: {
      send_counter: 0,
      new_account_state_hash: 'a0'.repeat(32),
      output_coins_root: 'a1'.repeat(32),
      input_nullifiers_root: 'a2'.repeat(32),
      coin_history_root: 'a3'.repeat(32),
      nav_commitment: 'a4'.repeat(32),
      npk_commit: '22'.repeat(32),
      proof_data_hash: '11'.repeat(32),
      txn_pubkey: 'a5'.repeat(32),
    },
    ...overrides,
  } as V1Job;
}

const spies: Array<ReturnType<typeof vi.spyOn>> = [];

type V1ClientMethod = keyof {
  [K in keyof ZkCoinsV1Client as ZkCoinsV1Client[K] extends (...args: never[]) => unknown
    ? K
    : never]: true;
};

function spyProto<K extends V1ClientMethod>(
  method: K,
  impl: ZkCoinsV1Client[K],
): ReturnType<typeof vi.spyOn> {
  const s = vi.spyOn(ZkCoinsV1Client.prototype, method).mockImplementation(impl as never);
  spies.push(s);
  return s;
}

/** Pre-sign poll and post-sign reconcile share getJob. */
function spyGetJobAfterAwaiting(
  impl: (id: string, signal?: AbortSignal) => Promise<{ job: V1Job; retryAfterMs: number | null }>,
  awaiting: V1Job = awaitingJob(),
): ReturnType<typeof vi.spyOn> {
  let preSign = true;
  return spyProto('getJob', async (id, signal) => {
    if (preSign) {
      preSign = false;
      return { job: awaiting, retryAfterMs: 10 };
    }
    return impl(id, signal);
  });
}

function mockHappyHandshake(opts: { sendCounter?: number; phases?: string[] } = {}) {
  const sendCounter = opts.sendCounter ?? 0;
  spyProto('openOwnershipPullSession', async () => ({
    session: 'pull-sess',
    session_expiry: '2099-01-01T00:00:00.000Z',
    records: [],
  }));
  spyProto('getAccountState', async () => ({
    account_state: 'ac'.repeat(32),
    state_head: 'ad'.repeat(32),
    send_counter: sendCounter,
    current_pubkey: 'aa'.repeat(32),
  }));
  spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
  spyProto('waitForAwaitingSignature', async () =>
    awaitingJob({
      awaiting_signature: {
        send_counter: sendCounter,
        new_account_state_hash: 'a0'.repeat(32),
        output_coins_root: 'a1'.repeat(32),
        input_nullifiers_root: 'a2'.repeat(32),
        coin_history_root: 'a3'.repeat(32),
        nav_commitment: 'a4'.repeat(32),
        npk_commit: '22'.repeat(32),
        proof_data_hash: '11'.repeat(32),
        txn_pubkey: 'a5'.repeat(32),
      },
    }),
  );
  spyProto('signAwaiting', () => DUMMY_SIG);
  spyProto('signJob', async () => completedJob({ phase: 'signed' }));

  let getJobCalls = 0;
  let awaitingDelivered = false;
  const phases = opts.phases ?? ['proving', 'completed'];
  spyProto('getJob', async () => {
    // Pre-sign poll uses the same getJob as post-sign reconcile.
    if (!awaitingDelivered) {
      awaitingDelivered = true;
      return {
        job: awaitingJob({
          awaiting_signature: {
            send_counter: sendCounter,
            new_account_state_hash: 'a0'.repeat(32),
            output_coins_root: 'a1'.repeat(32),
            input_nullifiers_root: 'a2'.repeat(32),
            coin_history_root: 'a3'.repeat(32),
            nav_commitment: 'a4'.repeat(32),
            npk_commit: '22'.repeat(32),
            proof_data_hash: '11'.repeat(32),
            txn_pubkey: 'a5'.repeat(32),
          },
        }),
        retryAfterMs: 10,
      };
    }
    const phase = phases[Math.min(getJobCalls, phases.length - 1)]!;
    getJobCalls += 1;
    if (phase === 'completed') {
      return { job: completedJob({ phase }), retryAfterMs: null };
    }
    return {
      job: {
        ...completedJob({ status: 'proving', phase }),
        status: 'proving',
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
      serverError: 'upstream',
      code: 'bad_gateway',
    });
  });

  it('maps V1ApiError human message into serverError and preserves machineCode', async () => {
    spyProto('getJob', async () => {
      throw new V1ApiError(422, 'insufficient_funds', 'Insufficient funds');
    });
    let mapped: unknown;
    try {
      await api.getJob(JOB_ID);
    } catch (err) {
      mapped = err;
    }
    expect(mapped).toMatchObject({
      status: 422,
      serverError: 'Insufficient funds',
      code: 'insufficient_funds',
    });
    expect(mapped).toBeInstanceOf(ApiError);
    expect(userMessageFor(mapped as ApiError)).toBe(
      SERVER_ERROR_TO_USER_MESSAGE['Insufficient funds'],
    );
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
      session_expiry: '2099-01-01T00:00:00.000Z',
      records: [],
    }));
    spyProto('getAccountState', async () => ({
      account_state: 'ac'.repeat(32),
      state_head: 'ad'.repeat(32),
      send_counter: 3,
      current_pubkey: 'ab'.repeat(32),
    }));
    const head = await api.accountState({
      address: ADDR,
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
    });
    expect(head.send_counter).toBe(3);
  });

  it('accountState maps pull failures', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(401, 'unauthorized', '');
    });
    await expect(
      api.accountState({ address: ADDR, mnemonic: MNEMONIC, nkCommit: NK, accountIndex: 0 }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('getHistory maps pull records into UI items with limit/offset', async () => {
    spyProto('openOwnershipPullSession', async () => ({
      session: 's1',
      session_expiry: '2099-01-01T00:00:00.000Z',
      records: [
        {
          record_id: 'r0',
          record_type: 'coin',
          transition_kind: 'mint',
          blob_id: 'blob-r0',
          occurred_at: '2024-01-01T00:00:00.000Z',
        },
        {
          record_id: 'r1',
          record_type: 'coin',
          transition_kind: 'send',
          blob_id: 'blob-r1',
          occurred_at: '2024-01-02T00:00:00.000Z',
        },
        {
          record_id: 'r2',
          record_type: 'note',
          // no transition_kind — adapter emits unknown (no record_type fallback)
          blob_id: 'blob-r2',
          occurred_at: '1700000000',
        },
      ],
    }));
    const res = await api.getHistory(
      { address: ADDR, mnemonic: MNEMONIC, nkCommit: NK, accountIndex: 0 },
      { limit: 1, offset: 1 },
    );
    expect(res.total).toBe(3);
    expect(res.limit).toBe(1);
    expect(res.offset).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: 'r1',
      kind: 'unknown',
    });
    expect(res.items[0]).not.toHaveProperty('status');
    expect(res.items[0]).not.toHaveProperty('index');

    // Only mint stays mint; send/missing transition_kind → unknown
    const all = await api.getHistory({
      address: ADDR,
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
    });
    expect(all.items.map((i) => i.kind)).toEqual(['mint', 'unknown', 'unknown']);
  });

  it('getHistory defaults limit/offset and maps errors', async () => {
    spyProto('openOwnershipPullSession', async () => ({
      session: 's1',
      session_expiry: '2099-01-01T00:00:00.000Z',
      records: [],
    }));
    const empty = await api.getHistory({
      address: ADDR,
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
    });
    expect(empty).toEqual({ items: [], total: 0, limit: 50, offset: 0 });

    spyProto('openOwnershipPullSession', async () => {
      throw new Error('pull down');
    });
    await expect(
      api.getHistory({ address: ADDR, mnemonic: MNEMONIC, nkCommit: NK, accountIndex: 0 }),
    ).rejects.toThrow('pull down');
  });

  it('getHistory returns empty page for typed account-not-found', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', 'missing');
    });
    await expect(
      api.getHistory({ address: ADDR, mnemonic: MNEMONIC, nkCommit: NK, accountIndex: 0 }),
    ).resolves.toEqual({ items: [], total: 0, limit: 50, offset: 0 });

    await expect(
      api.getHistory(
        { address: ADDR, mnemonic: MNEMONIC, nkCommit: NK, accountIndex: 0 },
        { limit: 10, offset: 5 },
      ),
    ).resolves.toEqual({ items: [], total: 0, limit: 10, offset: 5 });
  });

  it('getTransaction finds a row or 404s', async () => {
    spyProto('openOwnershipPullSession', async () => ({
      session: 's1',
      session_expiry: '2099-01-01T00:00:00.000Z',
      records: [
        {
          record_id: 'tx-7',
          record_type: 'coin',
          transition_kind: 'send',
          blob_id: 'blob-tx-7',
          occurred_at: '2024-06-01T00:00:00.000Z',
        },
      ],
    }));
    const found = await api.getTransaction('tx-7', {
      address: ADDR,
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
    });
    expect(found.id).toBe('tx-7');
    expect(found.kind).toBe('unknown');

    await expect(
      api.getTransaction('missing', {
        address: ADDR,
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      status: 404,
      serverError: 'transaction not found',
      code: 'transaction_not_found',
    });
  });

  it('rejects malformed nkCommit hex fail-closed', async () => {
    await expect(
      api.accountState({ address: ADDR, mnemonic: MNEMONIC, nkCommit: 'zz', accountIndex: 0 }),
    ).rejects.toThrow(/nkCommit/);
  });

  it('forwards optional AbortSignal to openOwnershipPullSession and getAccountState', async () => {
    const ac = new AbortController();
    const pullSpy = spyProto('openOwnershipPullSession', async (_input, signal) => {
      expect(signal).toBe(ac.signal);
      return {
        session: 's1',
        session_expiry: '2099-01-01T00:00:00.000Z',
        records: [
          {
            record_id: 'r0',
            record_type: 'coin',
            transition_kind: 'mint',
            blob_id: 'blob-r0',
            occurred_at: '2024-01-01T00:00:00.000Z',
          },
        ],
      };
    });
    const stateSpy = spyProto('getAccountState', async (_session, signal) => {
      expect(signal).toBe(ac.signal);
      return {
        account_state: 'ac'.repeat(32),
        state_head: 'ad'.repeat(32),
        send_counter: 0,
        current_pubkey: 'ab'.repeat(32),
      };
    });

    await api.accountState(
      { address: ADDR, mnemonic: MNEMONIC, nkCommit: NK, accountIndex: 0 },
      { signal: ac.signal },
    );
    expect(pullSpy).toHaveBeenCalledTimes(1);
    expect(stateSpy).toHaveBeenCalledTimes(1);

    await api.getHistory(
      { address: ADDR, mnemonic: MNEMONIC, nkCommit: NK, accountIndex: 0 },
      { signal: ac.signal },
    );
    expect(pullSpy).toHaveBeenCalledTimes(2);
    // getHistory never calls getAccountState.
    expect(stateSpy).toHaveBeenCalledTimes(1);

    await api.getTransaction(
      'r0',
      { address: ADDR, mnemonic: MNEMONIC, nkCommit: NK, accountIndex: 0 },
      { signal: ac.signal },
    );
    expect(pullSpy).toHaveBeenCalledTimes(3);
    expect(stateSpy).toHaveBeenCalledTimes(1);
  });
});

describe('api.createCoin — account-state 404 vs live counter + handshake', () => {
  it('pre-pull 404 + sign-pull 404 builds Genesis head and signs', async () => {
    // Both ownership pulls 404: pre-pull seeds sendCounter=0; sign-pull
    // takes send_counter from the job field awaiting_signature.send_counter
    // (0 here) — not an invented literal — then signs with local genesis pubkey.
    const events: string[] = [];
    let pullCount = 0;
    const pull = spyProto('openOwnershipPullSession', async () => {
      pullCount += 1;
      if (pullCount === 2) events.push('second pull');
      throw new V1ApiError(404, 'not_found', 'missing account');
    });
    spyProto('getAccountState', async () => {
      throw new Error('getAccountState must not run when every pull 404s');
    });
    spyProto('submitTransition', async (body) => {
      events.push('submit');
      expect(body.kind).toBe('mint');
      if (body.kind === 'mint') {
        expect(body.issuance.creator_pubkey).toBe(
          encodeHexLower(spendKeyAt(MNEMONIC, 0, 0).publicKey),
        );
      }
      return { job_id: JOB_ID, status: 'accepted' };
    });
    const signAwaiting = spyProto('signAwaiting', (args) => {
      events.push('sign');
      expect(args.accountState.send_counter).toBe(0);
      expect(args.accountState.current_pubkey).toBe(
        encodeHexLower(spendKeyAt(MNEMONIC, 0, 0).publicKey),
      );
      expect(args.localPubkey).toEqual(
        spendKeyAt(MNEMONIC, args.awaiting.send_counter, 0).publicKey,
      );
      return DUMMY_SIG;
    });
    spyProto('signJob', async () => completedJob());
    let preSign = true;
    spyProto('getJob', async () => {
      if (preSign) {
        preSign = false;
        events.push('awaiting_signature');
        return { job: awaitingJob(), retryAfterMs: 10 };
      }
      return { job: completedJob(), retryAfterMs: null };
    });

    const phases: string[] = [];
    const job = await api.createCoin(
      {
        account_address: ADDR,
        name: 'Cover',
        decimals: 0,
        amount: '10',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      },
      { onPhase: (s) => phases.push(s.phase ?? s.status) },
    );
    expect(job.status).toBe('completed');
    expect(phases.length).toBeGreaterThan(0);
    expect(pull).toHaveBeenCalledTimes(2);
    expect(signAwaiting).toHaveBeenCalled();
    expect(events.indexOf('submit')).toBeLessThan(events.indexOf('awaiting_signature'));
    expect(events.indexOf('awaiting_signature')).toBeLessThan(events.indexOf('second pull'));
    expect(events.indexOf('second pull')).toBeLessThan(events.indexOf('sign'));
  });

  it('pre-pull 404 + sign-pull 404 with non-zero job send_counter refuses to sign', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', 'missing account');
    });
    spyProto('getAccountState', async () => {
      throw new Error('getAccountState must not run when every pull 404s');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    const nonGenesis = awaitingJob({
      awaiting_signature: {
        send_counter: 5,
        new_account_state_hash: 'a0'.repeat(32),
        output_coins_root: 'a1'.repeat(32),
        input_nullifiers_root: 'a2'.repeat(32),
        coin_history_root: 'a3'.repeat(32),
        nav_commitment: 'a4'.repeat(32),
        npk_commit: '22'.repeat(32),
        proof_data_hash: '11'.repeat(32),
        txn_pubkey: 'a5'.repeat(32),
      },
    });
    const signAwaiting = spyProto('signAwaiting', () => {
      throw new Error('signAwaiting must not run when job counter is non-genesis on 404');
    });
    const signJob = spyProto('signJob', async () => {
      throw new Error('signJob must not run when job counter is non-genesis on 404');
    });
    spyProto('getJob', async () => ({ job: nonGenesis, retryAfterMs: 10 }));

    const request = api.createCoin({
      account_address: ADDR,
      name: 'NonGenesis',
      decimals: 0,
      amount: '10',
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
    });
    await expect(request).rejects.toThrow(/send_counter is 5 \(non-genesis\)/);
    await expect(request).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'protocol',
    });
    expect(signAwaiting).not.toHaveBeenCalled();
    expect(signJob).not.toHaveBeenCalled();
  });

  it('maps malformed npk_rand after admit to a protocol JobFailedError', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', 'missing account');
    });
    spyProto('submitTransition', async (body) => {
      body.npk_rand = 'bad';
      return { job_id: JOB_ID, status: 'accepted' };
    });
    spyProto('waitForAwaitingSignature', async () => awaitingJob());
    const signAwaiting = spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('getJob', async () => ({ job: awaitingJob(), retryAfterMs: null }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'MalformedRand',
        decimals: 0,
        amount: '10',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'protocol',
      serverError: 'npk_rand: expected 32 bytes hex, got length 3',
      message: 'npk_rand: expected 32 bytes hex, got length 3',
    });
    expect(signAwaiting).not.toHaveBeenCalled();
  });

  it('pre-pull 404 + sign-pull 500 genesis (counter 0) still signs', async () => {
    let pullCalls = 0;
    spyProto('openOwnershipPullSession', async () => {
      pullCalls += 1;
      if (pullCalls === 1) {
        throw new V1ApiError(404, 'not_found', 'missing account');
      }
      throw new V1ApiError(500, 'internal_error', 'Account state unavailable');
    });
    const getState = spyProto('getAccountState', async () => {
      throw new Error('getAccountState must not run when sign-pull 500s');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    const signAwaiting = spyProto('signAwaiting', (args) => {
      expect(args.accountState.send_counter).toBe(0);
      return DUMMY_SIG;
    });
    spyProto('signJob', async () => completedJob());
    spyGetJobAfterAwaiting(async () => ({ job: completedJob(), retryAfterMs: null }));

    const job = await api.createCoin({
      account_address: ADDR,
      name: 'Genesis',
      decimals: 0,
      amount: '10',
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
    });
    expect(job.status).toBe('completed');
    expect(pullCalls).toBe(2);
    expect(getState).not.toHaveBeenCalled();
    expect(signAwaiting).toHaveBeenCalled();
  });

  it('pre-pull 404 + sign-pull 500 with non-zero job send_counter refuses to sign', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(500, 'internal_error', 'Account state unavailable');
    });
    spyProto('getAccountState', async () => {
      throw new Error('getAccountState must not run when every pull 500s');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    const signAwaiting = spyProto('signAwaiting', () => {
      throw new Error('signAwaiting must not run after non-genesis 500');
    });
    const signJob = spyProto('signJob', async () => {
      throw new Error('signJob must not run after non-genesis 500');
    });
    spyProto('getJob', async () => ({
      job: awaitingJob({
        awaiting_signature: {
          send_counter: 5,
          new_account_state_hash: 'a0'.repeat(32),
          output_coins_root: 'a1'.repeat(32),
          input_nullifiers_root: 'a2'.repeat(32),
          coin_history_root: 'a3'.repeat(32),
          nav_commitment: 'a4'.repeat(32),
          npk_commit: '22'.repeat(32),
          proof_data_hash: '11'.repeat(32),
          txn_pubkey: 'a5'.repeat(32),
        },
      }),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'Genesis',
        decimals: 0,
        amount: '10',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toThrow(/send_counter is 5 \(non-genesis\)/);
    expect(signAwaiting).not.toHaveBeenCalled();
    expect(signJob).not.toHaveBeenCalled();
  });

  it('uses live send_counter when account state is present', async () => {
    mockHappyHandshake({ sendCounter: 2, phases: ['completed'] });
    const job = await api.createCoin({
      account_address: ADDR,
      name: 'Live',
      decimals: 2,
      amount: '5',
      mnemonic: MNEMONIC,
      nkCommit: NK,
      asset_id: 'ab'.repeat(32),
      accountIndex: 0,
    });
    expect(job.status).toBe('completed');
  });

  it('pre-pull openOwnershipPullSession transport failure wraps as ApiError and does not submit', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new Error('Failed to fetch');
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run after pre-pull failure');
    });

    let thrown: unknown;
    try {
      await api.createCoin({
        account_address: ADDR,
        name: 'PullFail',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({ status: 0, message: 'Failed to fetch' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('pre-pull openOwnershipPullSession ApiError is rethrown and does not submit', async () => {
    const pullErr = new ApiError(503, 'upstream down');
    spyProto('openOwnershipPullSession', async () => {
      throw pullErr;
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run after pre-pull failure');
    });

    let thrown: unknown;
    try {
      await api.createCoin({
        account_address: ADDR,
        name: 'PullFail',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBe(pullErr);
    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({ status: 503, message: 'upstream down' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('pre-pull openOwnershipPullSession V1ApiError wraps as ApiError and does not submit', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(422, 'insufficient_funds', 'nope');
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run after pre-pull failure');
    });

    let thrown: unknown;
    try {
      await api.createCoin({
        account_address: ADDR,
        name: 'PullFail',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({
      status: 422,
      serverError: 'nope',
      code: 'insufficient_funds',
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('pre-pull openOwnershipPullSession JobFailedError is rethrown and does not submit', async () => {
    const pullErr = new JobFailedError('j1', 'unknown', 'x');
    spyProto('openOwnershipPullSession', async () => {
      throw pullErr;
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run after pre-pull failure');
    });

    let thrown: unknown;
    try {
      await api.createCoin({
        account_address: ADDR,
        name: 'PullFail',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBe(pullErr);
    expect(thrown).toBeInstanceOf(JobFailedError);
    expect(submit).not.toHaveBeenCalled();
  });

  it('pre-pull openOwnershipPullSession non-Error value wraps as ApiError and does not submit', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw 'offline';
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run after pre-pull failure');
    });

    let thrown: unknown;
    try {
      await api.createCoin({
        account_address: ADDR,
        name: 'PullFail',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({ status: 0 });
    expect((thrown as ApiError).message).toContain('offline');
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects a non-canonical amount with leading zeros', async () => {
    const pull = spyProto('openOwnershipPullSession', async () => {
      throw new Error('openOwnershipPullSession must not run for an invalid amount');
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run for an invalid amount');
    });

    let thrown: unknown;
    try {
      await api.createCoin({
        account_address: ADDR,
        name: 'Invalid',
        decimals: 0,
        amount: '0001',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: 'Error',
      message: 'createCoin: amount must be a positive unsigned decimal digit string, got "0001"',
    });
    expect(pull).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects a non-string amount before any network hop', async () => {
    const pull = spyProto('openOwnershipPullSession', async () => {
      throw new Error('openOwnershipPullSession must not run for a non-string amount');
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run for a non-string amount');
    });

    let thrown: unknown;
    try {
      await api.createCoin({
        account_address: ADDR,
        name: 'Invalid',
        decimals: 0,
        amount: 1 as unknown as string,
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: 'Error',
      message: 'createCoin: amount must be a positive unsigned decimal digit string, got 1',
    });
    expect(pull).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects an empty name before any network hop', async () => {
    const pull = spyProto('openOwnershipPullSession', async () => {
      throw new Error('openOwnershipPullSession must not run for an empty name');
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run for an empty name');
    });

    let thrown: unknown;
    try {
      await api.createCoin({
        account_address: ADDR,
        name: '',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: 'Error',
      message: 'createCoin: name must be a non-empty string, got ""',
    });
    expect(pull).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only name before any network hop', async () => {
    const pull = spyProto('openOwnershipPullSession', async () => {
      throw new Error('openOwnershipPullSession must not run for a whitespace-only name');
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run for a whitespace-only name');
    });

    let thrown: unknown;
    try {
      await api.createCoin({
        account_address: ADDR,
        name: '   ',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: 'Error',
      message: 'createCoin: name must be a non-empty string, got "   "',
    });
    expect(pull).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([
    { decimals: 99, label: 'above max' },
    { decimals: -1, label: 'negative' },
    { decimals: 1.5, label: 'non-integer' },
    { decimals: Number.NaN, label: 'NaN' },
  ])('rejects invalid decimals ($label) before any network hop', async ({ decimals }) => {
    const pull = spyProto('openOwnershipPullSession', async () => {
      throw new Error('openOwnershipPullSession must not run for invalid decimals');
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run for invalid decimals');
    });

    let thrown: unknown;
    try {
      await api.createCoin({
        account_address: ADDR,
        name: 'Invalid',
        decimals,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: 'Error',
      message: `createCoin: decimals must be an integer in 0..18, got ${JSON.stringify(decimals)}`,
    });
    expect(pull).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects amount "0" before any network hop', async () => {
    const pull = spyProto('openOwnershipPullSession', async () => {
      throw new Error('openOwnershipPullSession must not run for amount 0');
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run for amount 0');
    });

    let thrown: unknown;
    try {
      await api.createCoin({
        account_address: ADDR,
        name: 'Zero',
        decimals: 0,
        amount: '0',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: 'Error',
      message: 'createCoin: amount must be a positive unsigned decimal digit string, got "0"',
    });
    expect(pull).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('mint delegates to createCoin', async () => {
    mockHappyHandshake({ phases: ['completed'] });
    // First pull for createCoin account head: mockHappy already returns send_counter 0
    const job = await api.mint({ account_address: ADDR, mnemonic: MNEMONIC, nkCommit: NK }, '42');
    expect(job.status).toBe('completed');
  });
});

describe('runTransitionHandshake error branches via createCoin', () => {
  it('surfaces newIdempotencyKey throw as ApiError(0) and does not submit', async () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('no uuid');
    });
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run');
    });

    let thrown: unknown;
    try {
      await api.createCoin({
        account_address: ADDR,
        name: 'NoUuid',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).not.toBeInstanceOf(JobFailedError);
    expect(thrown).toMatchObject({ status: 0, message: 'no uuid' });
    expect(submit).not.toHaveBeenCalled();
  });

  it("surfaces newIdempotencyKey non-Error throw as ApiError(0, 'idempotency key unavailable') and does not submit", async () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw 'offline';
    });
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run');
    });

    let thrown: unknown;
    try {
      await api.createCoin({
        account_address: ADDR,
        name: 'NoUuidNonError',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).not.toBeInstanceOf(JobFailedError);
    expect(thrown).toMatchObject({ status: 0, message: 'idempotency key unavailable' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('handles a signal that was already aborted before the SDK asks to sleep', async () => {
    const controller = new AbortController();
    controller.abort('deadline elapsed');
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'AlreadyAborted',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      status: 'timeout',
      serverError: 'timed out waiting for awaiting_signature after 900000ms',
    });
  });

  it('maps a wait-for-signature transport failure to unknown', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async () => {
      throw new Error('transport disconnected');
    });
    spyProto('getJob', async () => {
      throw new Error('transport disconnected');
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'TransportFailure',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'unknown',
      serverError: 'submit outcome unknown, do not retry as a new transition',
    });
  });

  it('classifies an abort during a long Retry-After sleep as a timeout', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
      spyProto('openOwnershipPullSession', async () => {
        throw new V1ApiError(404, 'not_found', '');
      });
      spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
      spyProto('getJob', async () => {
        controller.abort();
        return {
          job: completedJob({ status: 'accepted', phase: 'accepted' }),
          retryAfterMs: 240_000,
        };
      });

      let thrown: unknown;
      try {
        await api.createCoin({
          account_address: ADDR,
          name: 'Timeout',
          decimals: 0,
          amount: '1',
          mnemonic: MNEMONIC,
          nkCommit: NK,
          accountIndex: 0,
        });
      } catch (err) {
        thrown = err;
      }

      expect(timeout).toHaveBeenCalledWith(900_000);
      expect(thrown).toBeInstanceOf(JobFailedError);
      expect(thrown).toMatchObject({
        jobId: JOB_ID,
        status: 'timeout',
        serverError: 'timed out waiting for awaiting_signature after 900000ms',
        message: 'timed out waiting for awaiting_signature after 900000ms',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws JobFailedError when wait returns failed', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('getJob', async () => ({
      job: completedJob({
        status: 'failed',
        error: { error: 'prove_failed', message: 'circuit boom' },
      }),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toBeInstanceOf(JobFailedError);
  });

  it('throws when job ends before signature in a non-failed terminal', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('getJob', async () => ({
      job: completedJob({ status: 'completed', awaiting_signature: undefined }),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'protocol',
      message: 'job ended in completed before signature',
    });
  });

  it('throws when awaiting_signature payload is missing', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('getJob', async () => ({
      job: awaitingJob({ awaiting_signature: undefined }),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'protocol',
      message: expect.stringMatching(/awaiting_signature payload/),
    });
  });

  it('recovers waitForAwaitingSignature without Retry-After via getJob poll', async () => {
    mockHappyHandshake();
    spyProto('waitForAwaitingSignature', async () => {
      throw new Error(
        'waitForAwaitingSignature(job-cover-1): non-terminal status accepted without Retry-After',
      );
    });
    let n = 0;
    spyProto('getJob', async () => {
      n += 1;
      if (n === 1) {
        return { job: awaitingJob(), retryAfterMs: null };
      }
      return { job: completedJob(), retryAfterMs: null };
    });

    const job = await api.createCoin({
      account_address: ADDR,
      name: 'RetryAfterMissing',
      decimals: 0,
      amount: '1',
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
    });
    expect(job.status).toBe('completed');
  });

  it('maps abort during submitTransition to timeout', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => {
      controller.abort();
      throw new Error('submit aborted by deadline');
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'SubmitTimeout',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      status: 'timeout',
      serverError: 'timed out waiting for submit after 180000ms',
    });
  });

  // SDK-own request timeout aborts without aborting the handshake signal.
  it('maps AbortError during submitTransition without signal abort to timeout', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'SubmitAbortError',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      status: 'timeout',
      serverError: 'timed out waiting for submit after 180000ms',
    });
  });

  // DOMException AbortError covers the err instanceof DOMException branch of isAbortLike.
  it('maps DOMException AbortError during submitTransition without signal abort to timeout', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => {
      throw new DOMException('aborted', 'AbortError');
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'SubmitDomExceptionAbortError',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      status: 'timeout',
      serverError: 'timed out waiting for submit after 180000ms',
    });
  });

  it('maps a generic submitTransition transport failure to unknown', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => {
      throw new Error('Failed to fetch');
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'SubmitFetchFail',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      status: 'unknown',
      serverError: 'submit outcome unknown, do not retry as a new transition',
    });
  });

  it('rethrows a proven pre-admit 4xx from submitTransition', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => {
      throw new V1ApiError(400, 'invalid_request', '');
    });

    const rejection = api.createCoin({
      account_address: ADDR,
      name: 'SubmitPreAdmit400',
      decimals: 0,
      amount: '1',
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
    });
    await expect(rejection).rejects.toBeInstanceOf(ApiError);
    await expect(rejection).rejects.toMatchObject({ status: 400 });
  });

  it('rethrows a proven pre-admit app ApiError from submitTransition', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => {
      throw new ApiError(403, 'forbidden');
    });

    const rejection = api.createCoin({
      account_address: ADDR,
      name: 'SubmitPreAdmitAppApiError403',
      decimals: 0,
      amount: '1',
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
    });
    await expect(rejection).rejects.toBeInstanceOf(ApiError);
    await expect(rejection).rejects.toMatchObject({ status: 403, name: 'ApiError' });
  });

  it('maps AbortError during waitForAwaitingSignature without signal abort to timeout', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('getJob', async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'WaitAbortError',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'timeout',
      serverError: 'timed out waiting for awaiting_signature after 900000ms',
    });
  });

  it('maps abort during rehydration pull to timeout', async () => {
    // Abort only after waitForAwaitingSignature succeeds, on the post-wait
    // rehydration pull (not the createCoin pre-pull).
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);

    let pullCalls = 0;
    spyProto('openOwnershipPullSession', async () => {
      pullCalls += 1;
      if (pullCalls === 1) {
        throw new V1ApiError(404, 'not_found', '');
      }
      controller.abort();
      throw new Error('rehydration pull aborted by deadline');
    });
    spyProto('getAccountState', async () => {
      throw new Error('getAccountState must not run when rehydration pull aborts');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyGetJobAfterAwaiting(async () => ({ job: completedJob(), retryAfterMs: null }));
    const signAwaiting = spyProto('signAwaiting', () => {
      throw new Error('must not run after rehydration timeout');
    });
    const signJob = spyProto('signJob', async () => {
      throw new Error('must not run after rehydration timeout');
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'RehydrateTimeout',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'timeout',
      serverError: 'timed out waiting for rehydrate after 180000ms',
    });
    expect(signAwaiting).not.toHaveBeenCalled();
    expect(signJob).not.toHaveBeenCalled();
  });

  it('maps AbortError during rehydration pull without signal abort to timeout', async () => {
    let pullCalls = 0;
    spyProto('openOwnershipPullSession', async () => {
      pullCalls += 1;
      if (pullCalls === 1) {
        throw new V1ApiError(404, 'not_found', '');
      }
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    spyProto('getAccountState', async () => {
      throw new Error('getAccountState must not run when rehydration pull aborts');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyGetJobAfterAwaiting(async () => ({ job: completedJob(), retryAfterMs: null }));
    const signAwaiting = spyProto('signAwaiting', () => {
      throw new Error('must not run after rehydration AbortError');
    });
    const signJob = spyProto('signJob', async () => {
      throw new Error('must not run after rehydration AbortError');
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'RehydrateAbortError',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'timeout',
      serverError: 'timed out waiting for rehydrate after 180000ms',
    });
    expect(signAwaiting).not.toHaveBeenCalled();
    expect(signJob).not.toHaveBeenCalled();
  });

  it('maps aborted signal plus 404 during rehydration to timeout, not genesis', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);

    let pullCalls = 0;
    spyProto('openOwnershipPullSession', async () => {
      pullCalls += 1;
      if (pullCalls === 1) {
        throw new V1ApiError(404, 'not_found', '');
      }
      controller.abort();
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('getAccountState', async () => {
      throw new Error('getAccountState must not run when rehydration pull 404s');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyGetJobAfterAwaiting(async () => ({ job: completedJob(), retryAfterMs: null }));
    const signAwaiting = spyProto('signAwaiting', () => {
      throw new Error('must not run after rehydration abort+404');
    });
    const signJob = spyProto('signJob', async () => {
      throw new Error('must not run after rehydration abort+404');
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'RehydrateAbort404',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'timeout',
      serverError: 'timed out waiting for rehydrate after 180000ms',
    });
    expect(signAwaiting).not.toHaveBeenCalled();
    expect(signJob).not.toHaveBeenCalled();
  });

  it('maps 401 during rehydration pull to unknown, not remintable ApiError', async () => {
    let pullCalls = 0;
    spyProto('openOwnershipPullSession', async () => {
      pullCalls += 1;
      if (pullCalls === 1) {
        throw new V1ApiError(404, 'not_found', '');
      }
      throw new V1ApiError(401, 'unauthorized', '');
    });
    spyProto('getAccountState', async () => {
      throw new Error('getAccountState must not run when rehydration pull returns 401');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyGetJobAfterAwaiting(async () => ({ job: completedJob(), retryAfterMs: null }));
    const signAwaiting = spyProto('signAwaiting', () => {
      throw new Error('must not run after rehydration 401');
    });
    const signJob = spyProto('signJob', async () => {
      throw new Error('must not run after rehydration 401');
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'Rehydrate401',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'unknown',
      serverError: 'submit outcome unknown, do not retry as a new transition',
    });
    expect(signAwaiting).not.toHaveBeenCalled();
    expect(signJob).not.toHaveBeenCalled();
  });

  it('maps network error after successful refuseOrSignAndSubmit to unknown via reconcileSignedJob', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    const submit = spyProto('submitTransition', async () => ({
      job_id: JOB_ID,
      status: 'accepted',
    }));
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => completedJob({ phase: 'signed' }));
    spyGetJobAfterAwaiting(async () => {
      throw new Error('network down');
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'PostSignNetworkUnknown',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'unknown',
      message: expect.stringMatching(
        /signature submit outcome unknown.*do not retry as a new transition/i,
      ),
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('reconciles abort during refuseOrSignAndSubmit via getJob to completed', async () => {
    const controller = new AbortController();
    let timeoutCalls = 0;
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      timeoutCalls += 1;
      if (timeoutCalls === 1) return controller.signal;
      return new AbortController().signal;
    });

    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    const submit = spyProto('submitTransition', async () => ({
      job_id: JOB_ID,
      status: 'accepted',
    }));
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => {
      controller.abort();
      throw new Error('sign submit aborted by deadline');
    });
    spyGetJobAfterAwaiting(async () => ({
      job: completedJob(),
      retryAfterMs: null,
    }));

    const job = await api.createCoin({
      account_address: ADDR,
      name: 'RefuseReconcileOk',
      decimals: 0,
      amount: '1',
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
    });
    expect(job.status).toBe('completed');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('reconciles abort during refuseOrSignAndSubmit via getJob to failed', async () => {
    const controller = new AbortController();
    let timeoutCalls = 0;
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      timeoutCalls += 1;
      if (timeoutCalls === 1) return controller.signal;
      return new AbortController().signal;
    });

    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    const submit = spyProto('submitTransition', async () => ({
      job_id: JOB_ID,
      status: 'accepted',
    }));
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => {
      controller.abort();
      throw new Error('sign submit aborted by deadline');
    });
    spyGetJobAfterAwaiting(async () => ({
      job: completedJob({
        status: 'failed',
        error: { message: 'prove failed after sign' },
      }),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'RefuseReconcileFailed',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'failed',
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('maps unknown when post-sign reconcile cannot learn terminal status', async () => {
    const controller = new AbortController();
    let timeoutCalls = 0;
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      timeoutCalls += 1;
      if (timeoutCalls === 1) return controller.signal;
      return new AbortController().signal;
    });

    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    const submit = spyProto('submitTransition', async () => ({
      job_id: JOB_ID,
      status: 'accepted',
    }));
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => {
      controller.abort();
      throw new Error('sign submit aborted by deadline');
    });
    spyGetJobAfterAwaiting(async () => {
      throw new Error('network down during reconcile');
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'RefuseReconcileUnknown',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'unknown',
      message: expect.stringMatching(
        /signature submit outcome unknown.*do not retry as a new transition/i,
      ),
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('reconciles AbortError during refuseOrSignAndSubmit via getJob', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    const submit = spyProto('submitTransition', async () => ({
      job_id: JOB_ID,
      status: 'accepted',
    }));
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    spyGetJobAfterAwaiting(async () => ({
      job: completedJob(),
      retryAfterMs: null,
    }));

    const job = await api.createCoin({
      account_address: ADDR,
      name: 'RefuseAbortError',
      decimals: 0,
      amount: '1',
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
    });
    expect(job.status).toBe('completed');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('reconciles non-abort Error during refuseOrSignAndSubmit via getJob to completed', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    const submit = spyProto('submitTransition', async () => ({
      job_id: JOB_ID,
      status: 'accepted',
    }));
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => {
      throw new Error('sign post network blip');
    });
    spyGetJobAfterAwaiting(async () => ({
      job: completedJob(),
      retryAfterMs: null,
    }));

    const job = await api.createCoin({
      account_address: ADDR,
      name: 'RefuseNonAbortReconcileOk',
      decimals: 0,
      amount: '1',
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
    });
    expect(job.status).toBe('completed');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('maps non-abort Error during refuseOrSignAndSubmit to unknown when getJob fails', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    const submit = spyProto('submitTransition', async () => ({
      job_id: JOB_ID,
      status: 'accepted',
    }));
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => {
      throw new Error('sign post network blip');
    });
    spyGetJobAfterAwaiting(async () => {
      throw new Error('network down');
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'RefuseNonAbortReconcileUnknown',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'unknown',
      message: expect.stringMatching(
        /signature submit outcome unknown.*do not retry as a new transition/i,
      ),
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('throws JobFailedError when wait returns cancelled with error.error only', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('getJob', async () => ({
      job: completedJob({
        status: 'cancelled',
        error: { error: 'user_cancelled' },
      }),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toBeInstanceOf(JobFailedError);
  });

  it('throws JobFailedError when handshake signal aborts after awaiting_signature and before sign', async () => {
    // Abort only after rehydrate succeeds so the check at signal.aborted
    // before signAwaiting is hit (sign phase), not rehydrate.
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);

    let pullCalls = 0;
    spyProto('openOwnershipPullSession', async () => {
      pullCalls += 1;
      if (pullCalls === 1) {
        throw new V1ApiError(404, 'not_found', '');
      }
      return {
        session: 'pull-sess',
        session_expiry: '2099-01-01T00:00:00.000Z',
        records: [],
      };
    });
    spyProto('getAccountState', async () => {
      controller.abort();
      return {
        account_state: 'ac'.repeat(32),
        state_head: 'ad'.repeat(32),
        send_counter: 0,
        current_pubkey: 'aa'.repeat(32),
      };
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyGetJobAfterAwaiting(async () => ({ job: completedJob(), retryAfterMs: null }));
    const signAwaiting = spyProto('signAwaiting', () => {
      throw new Error('must not run after handshake signal abort');
    });
    const signJob = spyProto('signJob', async () => {
      throw new Error('must not run after handshake signal abort');
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'PostAwaitAbort',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'timeout',
      serverError: 'timed out waiting for sign after 180000ms',
      message: 'timed out waiting for sign after 180000ms',
    });
    expect(signAwaiting).not.toHaveBeenCalled();
    expect(signJob).not.toHaveBeenCalled();
  });

  it('maps KeyBindingRefusalError from signAwaiting to unknown without reconciling', async () => {
    const refusal = new KeyBindingRefusalError({
      localPubkey: new Uint8Array(32),
      currentPubkey: new Uint8Array(32),
      txnPubkey: new Uint8Array(32),
      sendCounter: 0,
    });
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', 'missing account');
    });
    spyProto('getAccountState', async () => {
      throw new Error('getAccountState must not run when every pull 404s');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('signAwaiting', () => {
      throw refusal;
    });
    const signJob = spyProto('signJob', async () => completedJob());
    const getJob = spyGetJobAfterAwaiting(async () => ({
      job: completedJob(),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'KeyBindRefuse',
        decimals: 0,
        amount: '10',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'unknown',
      serverError: refusal.message,
      message: refusal.message,
    });
    expect(signJob).not.toHaveBeenCalled();
    expect(getJob).toHaveBeenCalled();
  });

  it('maps a plain Error from signAwaiting to unknown without reconciling', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', 'missing account');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('signAwaiting', () => {
      throw new Error('local signer failed');
    });
    const signJob = spyProto('signJob', async () => completedJob());
    const getJob = spyGetJobAfterAwaiting(async () => ({
      job: completedJob(),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'SignerError',
        decimals: 0,
        amount: '10',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'unknown',
      serverError: 'local signer failed',
      message: 'local signer failed',
    });
    expect(signJob).not.toHaveBeenCalled();
    expect(getJob).toHaveBeenCalled();
  });

  it('maps an opaque rejection from signAwaiting to unknown without reconciling', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', 'missing account');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('signAwaiting', () => {
      throw 'opaque signer failure';
    });
    const signJob = spyProto('signJob', async () => completedJob());
    const getJob = spyGetJobAfterAwaiting(async () => ({
      job: completedJob(),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'OpaqueSignerError',
        decimals: 0,
        amount: '10',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      jobId: JOB_ID,
      status: 'unknown',
      serverError: 'opaque signer failure',
      message: 'opaque signer failure',
    });
    expect(signJob).not.toHaveBeenCalled();
    expect(getJob).toHaveBeenCalled();
  });

  it('passes through JobFailedError from signAwaiting without reconciling', async () => {
    const jobErr = new JobFailedError(JOB_ID, 'cancelled', 'signing cancelled');
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', 'missing account');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async () => awaitingJob());
    spyProto('signAwaiting', () => {
      throw jobErr;
    });
    const signJob = spyProto('signJob', async () => completedJob());
    const getJob = spyGetJobAfterAwaiting(async () => ({
      job: completedJob(),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'SignerJobError',
        decimals: 0,
        amount: '10',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toBe(jobErr);
    expect(signJob).not.toHaveBeenCalled();
    expect(getJob).toHaveBeenCalled();
  });

  // mapHandshakeAbort must rethrow the same JobFailedError instance (not wrap as timeout).
  it('passes through JobFailedError from submitTransition via mapHandshakeAbort', async () => {
    const jobErr = new JobFailedError('j', 'failed', 'prove failed');
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => {
      throw jobErr;
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'SubmitJobFailed',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toBe(jobErr);
    expect(jobErr.status).toBe('failed');
    expect(jobErr.serverError).toBe('prove failed');
    expect(jobErr.jobId).toBe('j');
  });

  // waitForAwaitingSignature catch must rethrow JobFailedError unchanged (not timeout/protocol).
  it('passes through JobFailedError from waitForAwaitingSignature', async () => {
    const jobErr = new JobFailedError('j', 'cancelled', 'operator');
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async () => {
      throw jobErr;
    });
    spyProto('getJob', async () => {
      throw jobErr;
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'WaitJobFailed',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toBe(jobErr);
    expect(jobErr.status).toBe('cancelled');
    expect(jobErr.serverError).toBe('operator');
    expect(jobErr.jobId).toBe('j');
  });
});

describe('waitForJob branches via completed handshake + poll', () => {
  it('fails closed when non-terminal status lacks Retry-After', async () => {
    // Pre-pull 404 → sendCounter=0; sign-pull 404 builds Genesis locally.
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    const submit = spyProto('submitTransition', async () => ({
      job_id: JOB_ID,
      status: 'accepted',
    }));
    spyProto('waitForAwaitingSignature', async () => awaitingJob());
    spyProto('getAccountState', async () => ({
      account_state: 'ac'.repeat(32),
      state_head: 'ad'.repeat(32),
      send_counter: 0,
      current_pubkey: 'aa'.repeat(32),
    }));
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => completedJob({ status: 'proving', phase: 'proving' }));
    let afterSign = 0;
    spyGetJobAfterAwaiting(async () => {
      afterSign += 1;
      if (afterSign === 1) {
        return {
          job: completedJob({ status: 'proving', phase: 'proving' }),
          retryAfterMs: null,
        };
      }
      return { job: completedJob(), retryAfterMs: null };
    });

    const job = await api.createCoin({
      account_address: ADDR,
      name: 'X',
      decimals: 0,
      amount: '1',
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
    });
    expect(job.status).toBe('completed');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('throws JobFailedError on failed poll status and surfaces error.message', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('getAccountState', async () => ({
      account_state: 'ac'.repeat(32),
      state_head: 'ad'.repeat(32),
      send_counter: 0,
      current_pubkey: 'aa'.repeat(32),
    }));
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async () => awaitingJob());
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => completedJob({ status: 'proving' }));
    spyGetJobAfterAwaiting(async () => ({
      job: completedJob({
        status: 'failed',
        error: { message: 'prove exploded' },
      }),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({ serverError: 'prove exploded' });
  });

  it('surfaces job.error.error when message is absent on cancelled poll', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('getAccountState', async () => ({
      account_state: 'ac'.repeat(32),
      state_head: 'ad'.repeat(32),
      send_counter: 0,
      current_pubkey: 'aa'.repeat(32),
    }));
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async (_id, opts) => {
      if (opts?.sleep) await opts.sleep(5);
      return awaitingJob();
    });
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => completedJob({ status: 'proving' }));
    spyGetJobAfterAwaiting(async () => ({
      job: completedJob({
        status: 'cancelled',
        error: { error: 'user_cancelled_only' },
      }),
      retryAfterMs: null,
    }));

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({ serverError: 'user_cancelled_only' });
  });

  it('polls with Retry-After floor and notifies phase changes', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('getAccountState', async () => ({
      account_state: 'ac'.repeat(32),
      state_head: 'ad'.repeat(32),
      send_counter: 0,
      current_pubkey: 'aa'.repeat(32),
    }));
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => completedJob({ status: 'proving', phase: 'proving' }));

    let poll = 0;
    spyGetJobAfterAwaiting(async () => {
      poll += 1;
      if (poll === 1) {
        return {
          job: completedJob({ status: 'proving', phase: 'proving' }),
          retryAfterMs: 5, // below POLL_FLOOR_MS → floor applies
        };
      }
      return { job: completedJob({ phase: 'completed' }), retryAfterMs: null };
    });

    const phases: string[] = [];
    const job = await api.createCoin(
      {
        account_address: ADDR,
        name: 'X',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      },
      { onPhase: (j) => phases.push(String(j.phase)) },
    );
    expect(job.status).toBe('completed');
    expect(phases).toContain('awaiting_signature');
    expect(phases).toContain('proving');
  });

  it('times out when the job stays non-terminal past WAIT_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    try {
      spyProto('openOwnershipPullSession', async () => {
        throw new V1ApiError(404, 'not_found', '');
      });
      spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
      // Resolve immediately — no sleep on AbortSignal, so handshake timeout does not steal.
      spyProto('waitForAwaitingSignature', async () => awaitingJob());
      spyProto('signAwaiting', () => DUMMY_SIG);
      spyProto('signJob', async () => completedJob({ status: 'proving', phase: 'proving' }));
      // retryAfterMs above MAX_POLL_SLEEP_MS — waitForJob must cap sleep and time out.
      let seenSignal: AbortSignal | undefined;
      spyGetJobAfterAwaiting(async (_id, signal) => {
        seenSignal = signal;
        return {
          job: completedJob({ status: 'proving', phase: 'proving' }),
          retryAfterMs: 900_000,
        };
      });

      const pending = api.createCoin({
        account_address: ADDR,
        name: 'Timeout',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });

      const assertion = expect(pending).rejects.toMatchObject({
        name: 'JobFailedError',
        status: 'unknown',
        message: expect.stringMatching(
          /signature submit outcome unknown.*do not retry as a new transition/i,
        ),
      });
      await vi.advanceTimersByTimeAsync(900_000);
      await assertion;
      expect(seenSignal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out when remainingForSleep is zero after a non-terminal getJob', async () => {
    vi.useFakeTimers();
    try {
      spyProto('openOwnershipPullSession', async () => {
        throw new V1ApiError(404, 'not_found', '');
      });
      spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
      spyProto('waitForAwaitingSignature', async () => awaitingJob());
      spyProto('signAwaiting', () => DUMMY_SIG);
      spyProto('signJob', async () => completedJob({ status: 'proving', phase: 'proving' }));

      let releaseGetJob!: (value: { job: V1Job; retryAfterMs: number }) => void;
      let resolveSaw!: () => void;
      const getJobSawCall = new Promise<void>((r) => {
        resolveSaw = r;
      });
      let preSign = true;
      spyProto('getJob', async () => {
        if (preSign) {
          preSign = false;
          return { job: awaitingJob(), retryAfterMs: 10 };
        }
        resolveSaw();
        return new Promise((resolve) => {
          releaseGetJob = resolve;
        });
      });

      const pending = api.createCoin({
        account_address: ADDR,
        name: 'TimeoutRemainingZero',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
      const assertion = expect(pending).rejects.toMatchObject({
        name: 'JobFailedError',
        status: 'unknown',
      });
      await getJobSawCall;
      await vi.advanceTimersByTimeAsync(900_000);
      releaseGetJob({
        job: completedJob({ status: 'proving', phase: 'proving' }),
        retryAfterMs: 10,
      });
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out when deadlineSignal aborts during poll sleep', async () => {
    vi.useFakeTimers();
    try {
      // Abort hits the reconcile wait signal used after a successful signature POST.
      const handshakeController = new AbortController();
      vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => handshakeController.signal);
      spyProto('openOwnershipPullSession', async () => {
        throw new V1ApiError(404, 'not_found', '');
      });
      spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
      spyProto('waitForAwaitingSignature', async () => awaitingJob());
      spyProto('signAwaiting', () => DUMMY_SIG);
      spyProto('signJob', async () => completedJob({ status: 'proving', phase: 'proving' }));
      spyGetJobAfterAwaiting(async () => ({
        job: completedJob({ status: 'proving', phase: 'proving' }),
        retryAfterMs: 10,
      }));

      const pending = api.createCoin({
        account_address: ADDR,
        name: 'TimeoutDeadlineAbort',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      });
      const assertion = expect(pending).rejects.toMatchObject({
        name: 'JobFailedError',
        status: 'unknown',
      });
      // enter sleep (POLL_FLOOR_MS is 1500); advance less than floor
      await vi.advanceTimersByTimeAsync(100);
      handshakeController.abort();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps getJob abort to JobFailedError and rethrows non-abort getJob errors', async () => {
    vi.useFakeTimers();
    try {
      const handshakeController = new AbortController();
      vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => handshakeController.signal);
      spyProto('openOwnershipPullSession', async () => {
        throw new V1ApiError(404, 'not_found', '');
      });
      spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
      spyProto('waitForAwaitingSignature', async () => awaitingJob());
      spyProto('signAwaiting', () => DUMMY_SIG);
      spyProto('signJob', async () => completedJob({ status: 'proving', phase: 'proving' }));

      let getJobCalls = 0;
      spyGetJobAfterAwaiting(async () => {
        getJobCalls += 1;
        if (getJobCalls === 1) {
          handshakeController.abort();
          throw new Error('fetch aborted');
        }
        throw new Error('unexpected getJob call');
      });

      await expect(
        api.createCoin({
          account_address: ADDR,
          name: 'GetJobAbort',
          decimals: 0,
          amount: '1',
          mnemonic: MNEMONIC,
          nkCommit: NK,
          accountIndex: 0,
        }),
      ).rejects.toMatchObject({
        name: 'JobFailedError',
        status: 'unknown',
        message: expect.stringMatching(
          /signature submit outcome unknown.*do not retry as a new transition/i,
        ),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps getJob network errors after successful sign to unknown via reconcileSignedJob', async () => {
    vi.useFakeTimers();
    try {
      spyProto('openOwnershipPullSession', async () => {
        throw new V1ApiError(404, 'not_found', '');
      });
      spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
      spyProto('waitForAwaitingSignature', async () => awaitingJob());
      spyProto('signAwaiting', () => DUMMY_SIG);
      spyProto('signJob', async () => completedJob({ status: 'proving', phase: 'proving' }));
      spyGetJobAfterAwaiting(async () => {
        throw new Error('node unavailable');
      });

      await expect(
        api.createCoin({
          account_address: ADDR,
          name: 'GetJobRethrow',
          decimals: 0,
          amount: '1',
          mnemonic: MNEMONIC,
          nkCommit: NK,
          accountIndex: 0,
        }),
      ).rejects.toMatchObject({
        name: 'JobFailedError',
        status: 'unknown',
        message: expect.stringMatching(
          /signature submit outcome unknown.*do not retry as a new transition/i,
        ),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // SDK-own getJob timeout: AbortError with signal.aborted still false.
  it('maps getJob AbortError without signal abort to unknown after successful sign', async () => {
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async () => awaitingJob());
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => completedJob({ status: 'proving', phase: 'proving' }));
    spyGetJobAfterAwaiting(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'GetJobAbortError',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toMatchObject({
      name: 'JobFailedError',
      status: 'unknown',
      message: expect.stringMatching(
        /signature submit outcome unknown.*do not retry as a new transition/i,
      ),
    });
  });

  // waitForJob getJob-catch muss dieselbe JobFailedError-Instanz rethrowen, nicht als timeout wrappen.
  it('passes through JobFailedError from getJob via waitForJob', async () => {
    const jobErr = new JobFailedError('j', 'failed', 'prove failed');
    spyProto('openOwnershipPullSession', async () => {
      throw new V1ApiError(404, 'not_found', '');
    });
    spyProto('submitTransition', async () => ({ job_id: JOB_ID, status: 'accepted' }));
    spyProto('waitForAwaitingSignature', async () => awaitingJob());
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => completedJob({ status: 'proving', phase: 'proving' }));
    spyProto('getJob', async () => {
      throw jobErr;
    });

    await expect(
      api.createCoin({
        account_address: ADDR,
        name: 'WaitForJobGetJobFailed',
        decimals: 0,
        amount: '1',
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
      }),
    ).rejects.toBe(jobErr);
    expect(jobErr.status).toBe('failed');
    expect(jobErr.serverError).toBe('prove failed');
    expect(jobErr.jobId).toBe('j');
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
        amount: '1',
        asset_id: 'aa'.repeat(32),
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
        delivery: invoiceDelivery,
        input_coins: ['ff'.repeat(32)],
      }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it('rejects a non-canonical amount with leading zeros before any network hop', async () => {
    const pull = spyProto('openOwnershipPullSession', async () => {
      throw new Error('openOwnershipPullSession must not run for an invalid amount');
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run for an invalid amount');
    });

    let thrown: unknown;
    try {
      await api.send({
        account_address: ADDR,
        recipient: ADDR,
        amount: '0001',
        asset_id: 'aa'.repeat(32),
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
        delivery: invoiceDelivery,
        input_coins: ['ff'.repeat(32)],
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: 'Error',
      message: 'send: amount must be a non-empty unsigned decimal digit string, got "0001"',
    });
    expect(pull).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects a non-string amount before any network hop', async () => {
    const pull = spyProto('openOwnershipPullSession', async () => {
      throw new Error('openOwnershipPullSession must not run for a non-string amount');
    });
    const submit = spyProto('submitTransition', async () => {
      throw new Error('submitTransition must not run for a non-string amount');
    });

    let thrown: unknown;
    try {
      await api.send({
        account_address: ADDR,
        recipient: ADDR,
        amount: 1 as unknown as string,
        asset_id: 'aa'.repeat(32),
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
        delivery: invoiceDelivery,
        input_coins: ['ff'.repeat(32)],
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: 'Error',
      message: 'send: amount must be a non-empty unsigned decimal digit string, got 1',
    });
    expect(pull).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('api.info features fail-closed', () => {
  it('rejects missing features fail-closed', async () => {
    const malformedInfo: Partial<V1Info> = {
      network: 'regtest',
      protocol_version: 'v1',
    };
    // The unsafe cast deliberately simulates a malformed server response missing `features`.
    spyProto('info', async () => malformedInfo as unknown as V1Info);
    await expect(api.info()).rejects.toThrow(/features missing/);
  });

  // Empty human message after the V1ApiError prefix → mapV1Error falls back to machineCode.
  it('maps V1ApiError with empty human message to machineCode as serverError', async () => {
    spyProto('info', async () => {
      throw new V1ApiError(502, 'bad_gateway', '');
    });
    await expect(api.info()).rejects.toMatchObject({
      status: 502,
      serverError: 'bad_gateway',
      code: 'bad_gateway',
    });
  });
});
