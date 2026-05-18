import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useCapabilities } from '@/stores/capabilities';
import { api } from '@/lib/api/client';

const FAIL_CLOSED = {
  address_list: false,
  faucet: false,
  usernames: false,
  lnurl: false,
} as const;

const ALL_ON = {
  address_list: true,
  faucet: true,
  usernames: true,
  lnurl: true,
} as const;

beforeEach(() => {
  useCapabilities.setState({ capabilities: { ...FAIL_CLOSED }, loaded: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCapabilities — initial state', () => {
  it('boots with everything off and loaded=false', () => {
    expect(useCapabilities.getState().capabilities).toEqual(FAIL_CLOSED);
    expect(useCapabilities.getState().loaded).toBe(false);
  });
});

describe('useCapabilities.fetch — server response handling', () => {
  it('writes server capabilities to the store and sets loaded=true', async () => {
    vi.spyOn(api, 'info').mockResolvedValue({ network: 'Mutinynet', capabilities: ALL_ON });

    await useCapabilities.getState().fetch();

    expect(useCapabilities.getState().capabilities).toEqual(ALL_ON);
    expect(useCapabilities.getState().loaded).toBe(true);
  });

  it('falls back to fail-closed when the server omits the capabilities field', async () => {
    // Pre-#29 server: only `network`. Schema allows it, capabilities is undefined.
    vi.spyOn(api, 'info').mockResolvedValue({ network: 'Mutinynet' });

    await useCapabilities.getState().fetch();

    expect(useCapabilities.getState().capabilities).toEqual(FAIL_CLOSED);
    expect(useCapabilities.getState().loaded).toBe(true);
  });

  it('falls back to fail-closed when /api/info is unreachable', async () => {
    vi.spyOn(api, 'info').mockRejectedValue(new Error('network down'));

    await useCapabilities.getState().fetch();

    expect(useCapabilities.getState().capabilities).toEqual(FAIL_CLOSED);
    expect(useCapabilities.getState().loaded).toBe(true);
  });

  it('falls back to fail-closed when the response fails schema parsing', async () => {
    // `api.info` itself throws a ZodError on invalid responses; we surface
    // it as a rejected promise so the store's catch path runs.
    vi.spyOn(api, 'info').mockRejectedValue(new Error('zod parse failure'));

    await useCapabilities.getState().fetch();

    expect(useCapabilities.getState().capabilities).toEqual(FAIL_CLOSED);
    expect(useCapabilities.getState().loaded).toBe(true);
  });
});
