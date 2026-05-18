import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { z } from 'zod';
import { ApiError, api } from '@/lib/api/client';
import { KNOWN_SERVER_ERRORS } from '@/lib/api/errorMessages';
import {
  BalanceResponseSchema,
  InfoResponseSchema,
  MintResponseSchema,
  SendResponseSchema,
} from '@/lib/api/schemas';
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

/**
 * Typed mock helper. Forcing the caller to pick a `z.infer<typeof
 * Schema>` makes any drift between the test's stub response and the
 * schema (and therefore the real server's expected shape) a TS error,
 * not a runtime surprise. Mirrors the `createMockWasm` pattern in
 * `src/__tests__/_mocks/wasm.ts`.
 */
function mockJsonResponse<T>(data: T, status = 200): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

describe('api.mint', () => {
  it('sends POST to /api/mint with address and default amount', async () => {
    const stub: z.infer<typeof MintResponseSchema> = { success: true, proof_id: 1 };
    mockJsonResponse(stub);
    const result = await api.mint('abc123');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/mint',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ account_address: 'abc123', amount: 10_000 }),
      }),
    );
    expect(result).toEqual(stub);
  });

  it('sends custom amount', async () => {
    mockJsonResponse<z.infer<typeof MintResponseSchema>>({ success: true, proof_id: 2 });
    await api.mint('abc123', 5000);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.amount).toBe(5000);
  });
});

describe('api.balance', () => {
  it('sends GET to /api/balance with address query param', async () => {
    mockJsonResponse<z.infer<typeof BalanceResponseSchema>>({ balance: 42000 });
    const result = await api.balance('myaddress');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/balance?address=myaddress',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
    expect(result.balance).toBe(42000);
  });

  it('returns balance: 0 for unobserved addresses (200 OK)', async () => {
    // Server contract: a well-formed address that has never been
    // observed on chain returns 200 with `{balance: 0}`. Callers
    // (Onboarding, WalletScreen) rely on this to render the
    // "Wallet is empty" state for brand-new wallets.
    mockJsonResponse<z.infer<typeof BalanceResponseSchema>>({ balance: 0 });
    const result = await api.balance('unobserved-address');
    expect(result.balance).toBe(0);
  });

  it('throws on server errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve(JSON.stringify({ error: 'server down' })),
    });
    await expect(api.balance('any')).rejects.toThrow(/API error 500/);
  });
});

describe('api.send', () => {
  it('sends POST to /api/send with send request', async () => {
    mockJsonResponse<z.infer<typeof SendResponseSchema>>({ success: true, proof_id: 3 });
    const sendData = {
      account_address: 'sender',
      recipient: 'receiver',
      amount: 1000,
      public_key: 'pk',
      next_public_key: 'npk',
    };
    const result = await api.send(sendData);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/send',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(sendData),
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe('api.commit', () => {
  it('sends POST to /api/commit with commit request', async () => {
    mockJsonResponse<z.infer<typeof SendResponseSchema>>({ success: true, proof_id: 4 });
    const commitData = {
      proof_id: 4,
      public_key: 'pk',
      signature: 'sig',
      message: 'msg',
    };
    const result = await api.commit(commitData);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/commit',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(commitData),
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe('api.info', () => {
  it('sends GET to /api/info', async () => {
    mockJsonResponse<z.infer<typeof InfoResponseSchema>>({ network: 'Mutinynet' });
    const result = await api.info();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/info',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
    expect(result.network).toBe('Mutinynet');
  });
});

describe('error handling', () => {
  it('throws on non-ok response (raw text body)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });
    await expect(api.info()).rejects.toThrow('API error 500: Internal Server Error');
  });

  it('throws on 422 validation error (raw text body)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: () => Promise.resolve('Missing field: address'),
    });
    await expect(api.balance('bad')).rejects.toThrow('API error 422: Missing field: address');
  });

  it('throws on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    await expect(api.info()).rejects.toThrow('Network error');
  });

  it('throws on schema mismatch (server drift)', async () => {
    // Force a payload that no longer matches the schema (renamed field).
    // This is the load-bearing assertion for issue #68 W3 — drift now
    // throws at the boundary instead of leaking a half-typed object.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ networkName: 'Mutinynet' }),
      text: () => Promise.resolve('{"networkName":"Mutinynet"}'),
    });
    await expect(api.info()).rejects.toThrow();
  });
});

describe('ApiError (server PR #31 contract)', () => {
  // Helper that fakes a structured 4xx/5xx response with the PR-#31 body
  // shape `{success: false, error: "<server string>"}`.
  function mockErrorResponse(status: number, error: string): void {
    const body = JSON.stringify({ success: false, error });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
      json: () => Promise.resolve(JSON.parse(body)),
      text: () => Promise.resolve(body),
    });
  }

  it('throws a typed ApiError with status + serverError for structured 422', async () => {
    mockErrorResponse(422, 'Insufficient funds');
    try {
      await api.send({
        account_address: 'a',
        recipient: 'b',
        amount: 1,
        public_key: 'pk',
        next_public_key: 'npk',
      });
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(422);
      expect(apiErr.serverError).toBe('Insufficient funds');
      expect(apiErr.rawBody).toContain('Insufficient funds');
      expect(apiErr.message).toBe('API error 422: Insufficient funds');
    }
  });

  it('preserves the raw body when the response body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: () => Promise.resolve('Bad Gateway'),
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
  // unchanged, so the user-facing mapping in `errorMessages.ts` can
  // look it up by exact-string match.
  it.each(KNOWN_SERVER_ERRORS)(
    'produces ApiError.serverError === %j for the matching server response',
    async (errString) => {
      // 422 is the modal status; the actual status is irrelevant for
      // this round-trip assertion — we're checking string preservation.
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
    mockJsonResponse<z.infer<typeof InfoResponseSchema>>({ network: 'test' });
    await api.info();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom-api.example.com/api/info',
      expect.any(Object),
    );
  });
});
