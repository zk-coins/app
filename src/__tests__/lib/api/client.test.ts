import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '@/lib/api/client';
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

function mockResponse(data: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

describe('api.mint', () => {
  it('sends POST to /api/mint with address and default amount', async () => {
    mockResponse({ success: true, proof_id: 1 });
    const result = await api.mint('abc123');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/mint',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ account_address: 'abc123', amount: 10_000 }),
      }),
    );
    expect(result).toEqual({ success: true, proof_id: 1 });
  });

  it('sends custom amount', async () => {
    mockResponse({ success: true, proof_id: 2 });
    await api.mint('abc123', 5000);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.amount).toBe(5000);
  });
});

describe('api.balance', () => {
  it('sends GET to /api/balance with address query param', async () => {
    mockResponse({ balance: 42000 });
    const result = await api.balance('myaddress');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/balance?address=myaddress',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
    expect(result.balance).toBe(42000);
  });
});

describe('api.send', () => {
  it('sends POST to /api/send with send request', async () => {
    mockResponse({ success: true, proof_id: 3 });
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
    mockResponse({ success: true, proof_id: 4 });
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
    mockResponse({ network: 'Mutinynet' });
    const result = await api.info();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.zkcoins.app/api/info',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
    expect(result.network).toBe('Mutinynet');
  });
});

describe('error handling', () => {
  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });
    await expect(api.info()).rejects.toThrow('API error 500: Internal Server Error');
  });

  it('throws on 422 validation error', async () => {
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
});

describe('api url from store', () => {
  it('uses apiUrl from network store', async () => {
    useNetworkStore.setState({ apiUrl: 'https://custom-api.example.com' });
    mockResponse({ network: 'test' });
    await api.info();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom-api.example.com/api/info',
      expect.any(Object),
    );
  });
});
