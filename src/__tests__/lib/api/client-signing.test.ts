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

describe('api.sendSigned', () => {
  it('signs request and includes signature + timestamp', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, proof_id: 42 }),
    });

    const sendData = {
      account_address: 'aa'.repeat(32),
      recipient: 'bb'.repeat(32),
      amount: 5000,
      public_key: '02' + 'cc'.repeat(32),
      next_public_key: '02' + 'dd'.repeat(32),
    };

    const result = await api.sendSigned(sendData, 'xprv9s21ZrQH143K3GJpoapnV8SFfuZcECe', 3);

    expect(result.success).toBe(true);
    expect(result.proof_id).toBe(42);

    // Verify the request body contains signature and timestamp
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.account_address).toBe(sendData.account_address);
    expect(body.recipient).toBe(sendData.recipient);
    expect(body.amount).toBe(5000);
    expect(body.signature).toBeDefined();
    expect(typeof body.signature).toBe('string');
    expect(body.timestamp).toBeDefined();
    expect(typeof body.timestamp).toBe('number');
    // Timestamp should be within last 10 seconds
    const now = Math.floor(Date.now() / 1000);
    expect(body.timestamp).toBeGreaterThan(now - 10);
    expect(body.timestamp).toBeLessThanOrEqual(now);
  });

  it('calls WASM deriveSigningKey with correct index', async () => {
    const { initWasm } = await import('@zkcoins/wasm');
    const wasm = await initWasm();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, proof_id: null }),
    });

    await api.sendSigned(
      {
        account_address: 'aa'.repeat(32),
        recipient: 'bb'.repeat(32),
        amount: 1000,
        public_key: '02' + 'cc'.repeat(32),
        next_public_key: '02' + 'dd'.repeat(32),
      },
      'xprv_test_key',
      7,
    );

    expect(wasm.deriveSigningKey).toHaveBeenCalledWith('xprv_test_key', 7);
    expect(wasm.signSchnorr).toHaveBeenCalled();
  });
});
