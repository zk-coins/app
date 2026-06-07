/**
 * `api.getTransaction` — the typed `GET /api/history/{id}` adapter
 * (tx-detail feature). Mirrors the sibling `history.test.ts` discipline:
 * the REAL adapter runs against a mocked `fetch`, so the SDK delegation,
 * the URL shape, the schema validation, and the error envelope are all
 * exercised end-to-end (no spy on `api` itself).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, api, type TxDetail } from '@/lib/api/client';
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
});

const ADDRESS = 'aa'.repeat(32);

/** Fully-populated detail (every nullable present). */
const FULL_DETAIL: TxDetail = {
  id: 99,
  address: ADDRESS,
  txid: 'bb'.repeat(32),
  timestamp: 1_700_000_500,
  direction: 'send',
  amount: 6_000,
  counterparty: null,
  status: 'confirmed',
  block_height: 900_001,
  memo: null,
  balance_after: 4_000,
  balance_before: 10_000,
  num_sends_after: 1,
  commitment_public_key: '02'.padEnd(66, 'a'),
  circuit_digest: 'cd'.repeat(32),
  commit_output_value: 546,
};

/** From-genesis mint (every detail-only nullable null). */
const MINT_DETAIL: TxDetail = {
  ...FULL_DETAIL,
  id: 119,
  txid: null,
  direction: 'mint',
  amount: 10_000,
  status: 'pending',
  block_height: null,
  balance_after: 10_000,
  balance_before: null,
  num_sends_after: 0,
  commitment_public_key: null,
  commit_output_value: null,
};

function mockDetailResponse(data: TxDetail, status = 200): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  });
}

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

describe('api.getTransaction — request shape', () => {
  it('GETs /api/history/{id} with the address as a query param', async () => {
    mockDetailResponse(FULL_DETAIL);
    await api.getTransaction(99, ADDRESS);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toBe(`https://test-api.zkcoins.app/api/history/99?address=${ADDRESS}`);
  });

  it('reads the node URL from the network store on every call', async () => {
    useNetworkStore.setState({ apiUrl: 'https://other-node.example' });
    mockDetailResponse(MINT_DETAIL);
    await api.getTransaction(119, ADDRESS);
    expect(mockFetch.mock.calls[0][0]).toContain('https://other-node.example/api/history/119');
  });
});

describe('api.getTransaction — response parsing', () => {
  it('parses a fully-populated confirmed send', async () => {
    mockDetailResponse(FULL_DETAIL);
    const d = await api.getTransaction(99, ADDRESS);
    expect(d.balance_before).toBe(10_000);
    expect(d.num_sends_after).toBe(1);
    expect(d.commitment_public_key).toHaveLength(66);
    expect(d.commit_output_value).toBe(546);
  });

  it('parses a from-genesis mint (all detail-only nullables null)', async () => {
    mockDetailResponse(MINT_DETAIL);
    const d = await api.getTransaction(119, ADDRESS);
    expect(d.balance_before).toBeNull();
    expect(d.commitment_public_key).toBeNull();
    expect(d.commit_output_value).toBeNull();
    expect(d.status).toBe('pending');
  });

  it('rejects a response missing a detail-only field (schema drift guard)', async () => {
    const { balance_after: _omit, ...broken } = FULL_DETAIL;
    mockDetailResponse(broken as TxDetail);
    await expect(api.getTransaction(99, ADDRESS)).rejects.toThrow();
  });
});

describe('api.getTransaction — error envelope', () => {
  it('surfaces a 404 as ApiError with the node error string', async () => {
    mockErrorResponse(404, 'Transaction not found');
    const err = await api.getTransaction(999, ADDRESS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).serverError).toBe('Transaction not found');
  });

  it('surfaces a 422 (malformed input) as ApiError', async () => {
    mockErrorResponse(422, 'id must be a positive integer');
    await expect(api.getTransaction(1, 'not-hex')).rejects.toBeInstanceOf(ApiError);
  });

  it('surfaces a 500 (db / decode failure) as ApiError', async () => {
    mockErrorResponse(500, 'Database error while reading transaction');
    const err = await api.getTransaction(99, ADDRESS).catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(500);
  });
});
