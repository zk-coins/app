import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { z } from 'zod';
import { api } from '@/lib/api/client';
import {
  BalanceResponseSchema,
  ClaimUsernameResponseSchema,
  ResolveUsernameResponseSchema,
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

function mockJsonResponse<T>(data: T, status = 200): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

describe('api.resolveUsername', () => {
  it('sends GET to /api/username/resolve/{name}', async () => {
    mockJsonResponse<z.infer<typeof ResolveUsernameResponseSchema>>({
      username: 'alice',
      address: 'aa'.repeat(32),
    });
    const result = await api.resolveUsername('alice');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/username/resolve/alice',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
    expect(result.username).toBe('alice');
    expect(result.address).toBe('aa'.repeat(32));
  });

  it('encodes special characters in username', async () => {
    mockJsonResponse<z.infer<typeof ResolveUsernameResponseSchema>>({
      username: 'bob.btc',
      address: 'bb'.repeat(32),
    });
    await api.resolveUsername('bob.btc');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/username/resolve/bob.btc',
      expect.any(Object),
    );
  });

  it('throws on 404 when username not found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Username not found'),
    });
    await expect(api.resolveUsername('nonexistent')).rejects.toThrow(
      'API error 404: Username not found',
    );
  });
});

describe('api.claimUsername', () => {
  it('sends POST to /api/username/claim with signed payload', async () => {
    mockJsonResponse<z.infer<typeof ClaimUsernameResponseSchema>>({
      username: 'alice',
      address: 'aa'.repeat(32),
    });

    const result = await api.claimUsername({
      username: 'alice',
      address: 'aa'.repeat(32),
      xpriv: 'xprv9s21ZrQH143K3GJpoapnV8SFfuZcECe',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/username/claim',
      expect.objectContaining({ method: 'POST' }),
    );

    // Verify the request body contains the expected fields
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.username).toBe('alice');
    expect(body.address).toBe('aa'.repeat(32));
    expect(body.public_key).toBeDefined();
    expect(typeof body.public_key).toBe('string');
    expect(body.signature).toBeDefined();
    expect(typeof body.signature).toBe('string');
    expect(body.timestamp).toBeDefined();
    expect(typeof body.timestamp).toBe('number');

    // Timestamp should be within last 10 seconds
    const now = Math.floor(Date.now() / 1000);
    expect(body.timestamp).toBeGreaterThan(now - 10);
    expect(body.timestamp).toBeLessThanOrEqual(now);

    expect(result.username).toBe('alice');
    expect(result.address).toBe('aa'.repeat(32));
  });

  it('throws on 409 when username already taken', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () => Promise.resolve('Username already taken'),
    });
    await expect(
      api.claimUsername({
        username: 'taken',
        address: 'cc'.repeat(32),
        xpriv: 'xprv9s21ZrQH143K3GJpoapnV8SFfuZcECe',
      }),
    ).rejects.toThrow('API error 409: Username already taken');
  });
});

describe('api.balance with username', () => {
  it('returns username field when present', async () => {
    mockJsonResponse<z.infer<typeof BalanceResponseSchema>>({ balance: 50000, username: 'alice' });
    const result = await api.balance('aa'.repeat(32));
    expect(result.balance).toBe(50000);
    expect(result.username).toBe('alice');
  });

  it('returns undefined username when not set', async () => {
    mockJsonResponse<z.infer<typeof BalanceResponseSchema>>({ balance: 10000 });
    const result = await api.balance('bb'.repeat(32));
    expect(result.balance).toBe(10000);
    expect(result.username).toBeUndefined();
  });
});
