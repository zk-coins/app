/**
 * Delivery-bearing client paths (`api.send`, `api.createCoin` with delivery,
 * `api.placeDeliveryAt` success). `placeDeliveryCredential` is module-mocked
 * so structural position binding is tested without BIP-340 invoice crypto.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZkCoinsV1Client, V1ApiError, type DeliveryCredential, type V1Job } from '@zkcoins/sdk';
import { api } from '@/lib/api/client';
import { useNetworkStore } from '@/stores/network';

const placeDeliveryCredential = vi.hoisted(() =>
  vi.fn((output: Record<string, unknown>, delivery: DeliveryCredential) => ({
    ...output,
    delivery,
  })),
);

vi.mock('@zkcoins/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zkcoins/sdk')>();
  return {
    ...actual,
    placeDeliveryCredential: (
      output: Record<string, unknown>,
      delivery: DeliveryCredential,
      _opts?: unknown,
    ) => placeDeliveryCredential(output, delivery),
  };
});

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ADDR = 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const NK = '00'.repeat(32);
const JOB_ID = 'job-deliv-1';

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

const spies: Array<ReturnType<typeof vi.spyOn>> = [];

type V1ClientMethod = keyof {
  [K in keyof ZkCoinsV1Client as ZkCoinsV1Client[K] extends (...args: never[]) => unknown
    ? K
    : never]: true;
};

function spyProto<K extends V1ClientMethod>(method: K, impl: ZkCoinsV1Client[K]) {
  const s = vi.spyOn(ZkCoinsV1Client.prototype, method).mockImplementation(impl as never);
  spies.push(s);
  return s;
}

function completedJob(): V1Job {
  return {
    job_id: JOB_ID,
    kind: 'send',
    status: 'completed',
    phase: 'completed',
    progress: 1,
  } as V1Job;
}

function awaitingJob(sendCounter = 0): V1Job {
  return {
    job_id: JOB_ID,
    kind: 'send',
    status: 'awaiting_signature',
    phase: 'awaiting_signature',
    progress: 0.5,
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
  } as V1Job;
}

function mockHandshake(sendCounter = 0) {
  spyProto('openOwnershipPullSession', async () => ({
    session: 's',
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
  spyProto('waitForAwaitingSignature', async () => awaitingJob(sendCounter));
  spyProto('signAwaiting', () => DUMMY_SIG);
  spyProto('signJob', async () => completedJob());
  spyProto('getJob', async () => ({ job: completedJob(), retryAfterMs: null }));
}

beforeEach(() => {
  placeDeliveryCredential.mockClear();
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
});

describe('api.send with delivery placement', () => {
  it('completes handshake after placing delivery at output 0', async () => {
    mockHandshake(1);
    const job = await api.send(
      {
        account_address: ADDR,
        recipient: ADDR,
        amount: '7',
        asset_id: 'aa'.repeat(32),
        mnemonic: MNEMONIC,
        nkCommit: NK,
        accountIndex: 0,
        delivery: invoiceDelivery,
        input_coins: ['ff'.repeat(32)],
        confirmPinMismatch: true,
        pinOnFirstUse: true,
        publisher_pubkey: '99'.repeat(32),
      },
      { onPhase: () => undefined },
    );
    expect(job.status).toBe('completed');
    expect(placeDeliveryCredential).toHaveBeenCalled();
  });

  it('walletSend is a thin alias over send', async () => {
    mockHandshake(0);
    const job = await api.walletSend({
      account_address: ADDR,
      recipient: ADDR,
      amount: '1',
      asset_id: 'aa'.repeat(32),
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
      delivery: invoiceDelivery,
      input_coins: ['ee'.repeat(32)],
    });
    expect(job.status).toBe('completed');
  });
});

describe('api.createCoin with delivery', () => {
  it('places delivery on mint output when provided', async () => {
    // Pre-pull 404 → sendCounter=0; sign-pull 404 builds Genesis locally.
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
    spyProto('waitForAwaitingSignature', async () => awaitingJob(0));
    spyProto('signAwaiting', () => DUMMY_SIG);
    spyProto('signJob', async () => completedJob());
    spyProto('getJob', async () => ({ job: completedJob(), retryAfterMs: null }));

    const job = await api.createCoin({
      account_address: ADDR,
      name: 'Deliv',
      decimals: 0,
      amount: '1',
      mnemonic: MNEMONIC,
      nkCommit: NK,
      accountIndex: 0,
      delivery: invoiceDelivery,
    });
    expect(job.status).toBe('completed');
    expect(placeDeliveryCredential).toHaveBeenCalled();
  });
});

describe('api.placeDeliveryAt success path', () => {
  it('returns delivery only at the target index', () => {
    const templates = [
      { recipient: ADDR, asset_id: 'aa'.repeat(32), amount: '1' },
      { recipient: ADDR, asset_id: 'aa'.repeat(32), amount: '2' },
    ];
    const out = api.placeDeliveryAt(templates, 1, invoiceDelivery, 'regtest');
    expect(out[0]).not.toHaveProperty('delivery');
    expect(out[1]).toMatchObject({ amount: '2', delivery: invoiceDelivery });
    expect(placeDeliveryCredential).toHaveBeenCalled();
  });
});
