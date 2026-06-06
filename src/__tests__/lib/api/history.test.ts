import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { z } from 'zod';
import {
  ApiError,
  api,
  HistoryItemSchema,
  HistoryResponseSchema,
  HistoryErrorResponseSchema,
} from '@/lib/api/client';
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
 * Typed JSON-response mock. Forcing the stub to be `z.infer<typeof
 * HistoryResponseSchema>` makes any drift between the test fixture and the
 * wire schema (and therefore the node's serde) a TS error rather than a
 * runtime surprise — the same discipline the sibling `client.test.ts` uses.
 */
function mockHistoryResponse(
  data: z.infer<typeof HistoryResponseSchema>,
  status = 200,
  headers: Record<string, string> = {},
): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(headers),
  });
}

/** Non-2xx `{ error }` envelope mock (the 422 / 500 branches). */
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

const ADDRESS = 'aa'.repeat(32);

/** One fully-populated row (every nullable field present). */
const FULL_ITEM: z.infer<typeof HistoryItemSchema> = {
  id: 7,
  txid: 'bb'.repeat(32),
  timestamp: 1_700_000_000,
  direction: 'send',
  amount: 1_500,
  counterparty: 'cc'.repeat(32),
  status: 'confirmed',
  block_height: 850_123,
  memo: 'rent',
};

/** One row with every nullable field set to `null` (the schema-default node shape). */
const NULL_ITEM: z.infer<typeof HistoryItemSchema> = {
  id: 8,
  txid: null,
  timestamp: 1_700_000_100,
  direction: 'receive',
  amount: 2_000,
  counterparty: null,
  status: 'pending',
  block_height: null,
  memo: null,
};

describe('api.getHistory — request shape', () => {
  it('GETs /api/history with address, limit, and offset query params', async () => {
    mockHistoryResponse({ items: [FULL_ITEM], total: 1, limit: 10, offset: 20 });

    const result = await api.getHistory(ADDRESS, { limit: 10, offset: 20 });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      `https://test-api.zkcoins.app/api/history?address=${ADDRESS}&limit=10&offset=20`,
    );
    // Read endpoint — no method override means a default GET, never a POST.
    expect(init.method).toBeUndefined();
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(result.items).toHaveLength(1);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(20);
  });

  it('omits limit/offset from the query when called with no pagination opts', async () => {
    // Exercises the `opts = {}` default param branch in the adapter and the
    // SDK's "param only when defined" construction.
    mockHistoryResponse({ items: [], total: 0, limit: 50, offset: 0 });

    await api.getHistory(ADDRESS);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://test-api.zkcoins.app/api/history?address=${ADDRESS}`);
  });

  it('sends only limit when offset is omitted', async () => {
    mockHistoryResponse({ items: [], total: 0, limit: 25, offset: 0 });
    await api.getHistory(ADDRESS, { limit: 25 });
    expect(mockFetch.mock.calls[0][0]).toBe(
      `https://test-api.zkcoins.app/api/history?address=${ADDRESS}&limit=25`,
    );
  });

  it('sends only offset when limit is omitted', async () => {
    mockHistoryResponse({ items: [], total: 0, limit: 50, offset: 100 });
    await api.getHistory(ADDRESS, { offset: 100 });
    expect(mockFetch.mock.calls[0][0]).toBe(
      `https://test-api.zkcoins.app/api/history?address=${ADDRESS}&offset=100`,
    );
  });

  it('reads the apiUrl from the network store at call time', async () => {
    useNetworkStore.setState({ apiUrl: 'https://custom.example.com' });
    mockHistoryResponse({ items: [], total: 0, limit: 50, offset: 0 });
    await api.getHistory(ADDRESS);
    expect(mockFetch.mock.calls[0][0]).toBe(
      `https://custom.example.com/api/history?address=${ADDRESS}`,
    );
  });
});

describe('api.getHistory — response parsing', () => {
  it('parses a mixed page (mint/send/receive, all three statuses, nulls)', async () => {
    const mintItem: z.infer<typeof HistoryItemSchema> = {
      id: 9,
      txid: 'dd'.repeat(32),
      timestamp: 1_700_000_200,
      direction: 'mint',
      amount: 10_000,
      counterparty: null,
      status: 'failed',
      block_height: null,
      memo: null,
    };
    mockHistoryResponse({
      items: [FULL_ITEM, NULL_ITEM, mintItem],
      total: 3,
      limit: 50,
      offset: 0,
    });

    const result = await api.getHistory(ADDRESS);

    expect(result.items.map((i) => i.direction)).toEqual(['send', 'receive', 'mint']);
    expect(result.items.map((i) => i.status)).toEqual(['confirmed', 'pending', 'failed']);
    // Nullable fields survive as explicit null (not dropped / coerced).
    expect(result.items[1]).toMatchObject({
      txid: null,
      counterparty: null,
      block_height: null,
      memo: null,
    });
  });

  it('accepts `pending` as a steady-state status (node #153 round-2 default)', async () => {
    mockHistoryResponse({ items: [NULL_ITEM], total: 1, limit: 50, offset: 0 });
    const result = await api.getHistory(ADDRESS);
    expect(result.items[0].status).toBe('pending');
  });

  it('surfaces the node-filtered total verbatim (caller drives pagination)', async () => {
    // The node counts only mint/send/receive rows in `total`; it can far
    // exceed the returned page size so the caller can page without a
    // second round-trip.
    mockHistoryResponse({ items: [FULL_ITEM, NULL_ITEM], total: 42, limit: 2, offset: 0 });
    const result = await api.getHistory(ADDRESS, { limit: 2, offset: 0 });
    expect(result.total).toBe(42);
    expect(result.items).toHaveLength(2);
  });

  it('rejects a response whose row carries an out-of-contract direction', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            items: [{ ...FULL_ITEM, direction: 'scanner' }],
            total: 1,
            limit: 50,
            offset: 0,
          }),
        ),
      headers: new Headers(),
    });
    await expect(api.getHistory(ADDRESS)).rejects.toThrow();
  });

  it('rejects a response whose row carries an out-of-contract status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            items: [{ ...FULL_ITEM, status: 'broadcasting' }],
            total: 1,
            limit: 50,
            offset: 0,
          }),
        ),
      headers: new Headers(),
    });
    await expect(api.getHistory(ADDRESS)).rejects.toThrow();
  });
});

describe('api.getHistory — error envelope', () => {
  it('throws ApiError(422) with the node error string for malformed input', async () => {
    mockErrorResponse(422, 'limit must be in [1, 200]');
    const err = await api.getHistory(ADDRESS, { limit: 9_999 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).serverError).toBe('limit must be in [1, 200]');
  });

  it('throws ApiError(422) for a missing/invalid address', async () => {
    mockErrorResponse(422, 'Address must be 32 bytes (64 hex chars)');
    const err = await api.getHistory('zz').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).serverError).toBe('Address must be 32 bytes (64 hex chars)');
  });

  it('throws ApiError(500) carrying the DB error string', async () => {
    mockErrorResponse(500, 'Database error while reading history');
    const err = await api.getHistory(ADDRESS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).serverError).toBe('Database error while reading history');
  });
});

// The Zod schemas the app re-exports under the issue #145 names must mirror
// the node's `router::{HistoryItem,HistoryResponse,HistoryErrorResponse}`
// serde exactly. These cases pin that contract at the app boundary (the SDK
// owns the definitions; these assert the app surfaces the right ones).
describe('HistoryItemSchema', () => {
  it('accepts a fully-populated row', () => {
    expect(HistoryItemSchema.parse(FULL_ITEM)).toEqual(FULL_ITEM);
  });

  it('accepts null for every nullable field (txid/counterparty/block_height/memo)', () => {
    expect(HistoryItemSchema.parse(NULL_ITEM)).toEqual(NULL_ITEM);
  });

  it.each(['mint', 'send', 'receive'] as const)('accepts direction %j', (direction) => {
    expect(HistoryItemSchema.parse({ ...FULL_ITEM, direction }).direction).toBe(direction);
  });

  it.each(['pending', 'confirmed', 'failed'] as const)('accepts status %j', (status) => {
    expect(HistoryItemSchema.parse({ ...FULL_ITEM, status }).status).toBe(status);
  });

  it('rejects an unknown direction', () => {
    expect(() => HistoryItemSchema.parse({ ...FULL_ITEM, direction: 'recovery' })).toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() => HistoryItemSchema.parse({ ...FULL_ITEM, status: 'queued' })).toThrow();
  });

  it('rejects a missing required field (id)', () => {
    const { id: _id, ...withoutId } = FULL_ITEM;
    expect(() => HistoryItemSchema.parse(withoutId)).toThrow();
  });

  it('rejects a non-string txid (nullable does not mean any type)', () => {
    expect(() => HistoryItemSchema.parse({ ...FULL_ITEM, txid: 123 })).toThrow();
  });
});

describe('HistoryResponseSchema', () => {
  it('parses the paginated wrapper', () => {
    const resp = { items: [FULL_ITEM], total: 1, limit: 50, offset: 0 };
    expect(HistoryResponseSchema.parse(resp)).toEqual(resp);
  });

  it('rejects a wrapper missing the total counter', () => {
    expect(() => HistoryResponseSchema.parse({ items: [], limit: 50, offset: 0 })).toThrow();
  });
});

describe('HistoryErrorResponseSchema', () => {
  it('parses the flat { error } envelope', () => {
    expect(HistoryErrorResponseSchema.parse({ error: 'boom' })).toEqual({ error: 'boom' });
  });

  it('rejects an envelope without an error string', () => {
    expect(() => HistoryErrorResponseSchema.parse({})).toThrow();
  });
});
