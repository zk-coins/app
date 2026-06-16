import { describe, it, expect, vi, afterEach } from 'vitest';

// `EXPLORER_URL` is read from `process.env.NEXT_PUBLIC_EXPLORER_URL` at module
// load, so each scenario re-imports the module with the env var set first.
const ORIGINAL_URL = process.env.NEXT_PUBLIC_EXPLORER_URL;
const originalFetch = globalThis.fetch;

async function loadWith(url: string | undefined) {
  vi.resetModules();
  if (url === undefined) delete process.env.NEXT_PUBLIC_EXPLORER_URL;
  else process.env.NEXT_PUBLIC_EXPLORER_URL = url;
  return (await import('@/lib/api/explorer')).getNetworkActivity;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_EXPLORER_URL;
  else process.env.NEXT_PUBLIC_EXPLORER_URL = ORIGINAL_URL;
});

describe('getNetworkActivity', () => {
  it('falls back to the simulator when no explorer URL is configured', async () => {
    const getNetworkActivity = await loadWith(undefined);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const res = await getNetworkActivity();

    expect(res.source).toBe('simulated');
    expect(res.samples.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns explorer samples on a non-empty array response (trailing slash trimmed)', async () => {
    const getNetworkActivity = await loadWith('https://explorer.example/');
    const samples = [{ ts: 1, inKbps: 2, outKbps: 3 }];
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ samples }) });

    const res = await getNetworkActivity({ windowMs: 1000 });

    expect(res).toEqual({ samples, source: 'explorer' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://explorer.example/network/activity?window_ms=1000',
      { signal: undefined },
    );
  });

  it('falls back when the endpoint returns an empty array', async () => {
    const getNetworkActivity = await loadWith('https://explorer.example');
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ samples: [] }) });

    expect((await getNetworkActivity()).source).toBe('simulated');
  });

  it('falls back when `samples` is not an array', async () => {
    const getNetworkActivity = await loadWith('https://explorer.example');
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ samples: null }) });

    expect((await getNetworkActivity()).source).toBe('simulated');
  });

  it('falls back when the response is not ok', async () => {
    const getNetworkActivity = await loadWith('https://explorer.example');
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

    expect((await getNetworkActivity()).source).toBe('simulated');
  });

  it('falls back when fetch rejects (network/parse error)', async () => {
    const getNetworkActivity = await loadWith('https://explorer.example');
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom'));

    expect((await getNetworkActivity()).source).toBe('simulated');
  });
});
