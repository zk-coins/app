import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useCapabilities } from '@/stores/capabilities';
import { api } from '@/lib/api/client';

const FAIL_CLOSED = {
  address_list: false,
  username_claim: false,
  lnurl: false,
  multi_asset: false,
} as const;

const ALL_ON = {
  address_list: true,
  username_claim: true,
  lnurl: true,
  multi_asset: true,
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
    vi.spyOn(api, 'info').mockResolvedValue({
      network: 'testnet',
      protocol_version: 'v1',
      features: ['wallet'],
      capabilities: ALL_ON,
    });

    await useCapabilities.getState().fetch();

    expect(useCapabilities.getState().capabilities).toEqual(ALL_ON);
    expect(useCapabilities.getState().loaded).toBe(true);
  });

  it('derives capabilities from v1 features when the capabilities field is omitted', async () => {
    // Closed `/v1/info` advertises `features`; the app maps those into the
    // legacy capability booleans (no silent all-off when features are present).
    vi.spyOn(api, 'info').mockResolvedValue({
      network: 'testnet',
      protocol_version: 'v1',
      features: ['wallet'],
    });

    await useCapabilities.getState().fetch();

    expect(useCapabilities.getState().capabilities).toEqual({
      address_list: false,
      username_claim: true,
      lnurl: false,
      multi_asset: true,
    });
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
