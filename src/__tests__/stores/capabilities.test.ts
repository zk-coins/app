import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useCapabilities } from '@/stores/capabilities';
import { api } from '@/lib/api/client';
import { useNetworkStore } from '@/stores/network';

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

  it('fail-closes when the capabilities field is omitted', async () => {
    vi.spyOn(api, 'info').mockResolvedValue({
      network: 'testnet',
      protocol_version: 'v1',
      features: ['wallet'],
    });

    await useCapabilities.getState().fetch();

    expect(useCapabilities.getState().capabilities).toEqual(FAIL_CLOSED);
    expect(useCapabilities.getState().loaded).toBe(true);
    expect(useNetworkStore.getState().infoError).toMatch(/capabilities missing/);
  });

  it('falls back to fail-closed when /v1/info is unreachable', async () => {
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

  it('stringifies non-Error rejections into applyInfoFailure', async () => {
    vi.spyOn(api, 'info').mockRejectedValue('upstream-string-error');

    await useCapabilities.getState().fetch();

    expect(useCapabilities.getState().capabilities).toEqual(FAIL_CLOSED);
    expect(useCapabilities.getState().loaded).toBe(true);
  });

  it('fail-closes when both capabilities and features are absent', async () => {
    vi.spyOn(api, 'info').mockResolvedValue({
      network: 'regtest',
      protocol_version: 'v1',
    } as never);

    await useCapabilities.getState().fetch();

    expect(useCapabilities.getState().capabilities).toEqual(FAIL_CLOSED);
    expect(useCapabilities.getState().loaded).toBe(true);
    expect(useNetworkStore.getState().infoError).toMatch(/capabilities missing/);
  });

  it('coalesces concurrent fetch() into a single api.info call', async () => {
    let resolveInfo!: (v: {
      network: string;
      protocol_version: string;
      features: string[];
      capabilities: typeof ALL_ON;
    }) => void;
    const infoPromise = new Promise<{
      network: string;
      protocol_version: string;
      features: string[];
      capabilities: typeof ALL_ON;
    }>((r) => {
      resolveInfo = r;
    });
    const infoSpy = vi
      .spyOn(api, 'info')
      .mockReturnValue(infoPromise as ReturnType<typeof api.info>);

    const p1 = useCapabilities.getState().fetch();
    const p2 = useCapabilities.getState().fetch();
    expect(p1).toBe(p2);
    expect(infoSpy).toHaveBeenCalledTimes(1);

    resolveInfo({
      network: 'testnet',
      protocol_version: 'v1',
      features: ['wallet'],
      capabilities: ALL_ON,
    });
    await Promise.all([p1, p2]);

    expect(useCapabilities.getState().capabilities).toEqual(ALL_ON);
    expect(useCapabilities.getState().loaded).toBe(true);
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });
});
