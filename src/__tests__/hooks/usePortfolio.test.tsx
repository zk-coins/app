/**
 * `usePortfolio` — fail-loud portfolio hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { ApiError, api, type OwnerBalanceResponse } from '@/lib/api/client';

const ADDR_A = 'a'.repeat(64);
const ADDR_B = 'b'.repeat(64);

function portfolio(assets: OwnerBalanceResponse['assets'], address = ADDR_A): OwnerBalanceResponse {
  return { address, assets };
}

const ASSET = { asset_id: 'c'.repeat(64), name: 'X', decimals: 0, balance: 100, num_sends: 0 };

let ownerSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ownerSpy = vi.spyOn(api, 'ownerBalances');
});

afterEach(() => {
  vi.useRealTimers();
  ownerSpy.mockRestore();
});

describe('usePortfolio', () => {
  it('fetches on mount and exposes assets + loaded + available', async () => {
    ownerSpy.mockResolvedValue(portfolio([ASSET]));
    const { result } = renderHook(() => usePortfolio(ADDR_A));
    expect(result.current.loaded).toBe(false);

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.assets).toEqual([ASSET]);
    expect(result.current.available).toBe(true);
    expect(result.current.error).toBeNull();
    expect(ownerSpy).toHaveBeenCalledWith(ADDR_A);
  });

  it('re-polls every 5 s', async () => {
    ownerSpy
      .mockResolvedValueOnce(portfolio([]))
      .mockResolvedValueOnce(portfolio([ASSET]))
      .mockResolvedValue(portfolio([ASSET, { ...ASSET, asset_id: 'd'.repeat(64) }]));

    vi.useFakeTimers();
    const { result } = renderHook(() => usePortfolio(ADDR_A));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.assets).toEqual([]);
    expect(result.current.available).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current.assets).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current.assets).toHaveLength(2);
    expect(ownerSpy).toHaveBeenCalledTimes(3);
  });

  it('does not fetch when the address is undefined (parked)', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePortfolio(undefined));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(ownerSpy).not.toHaveBeenCalled();
    expect(result.current.assets).toEqual([]);
    expect(result.current.loaded).toBe(false);
    expect(result.current.available).toBe(false);
  });

  it('resets assets + loaded when the address changes', async () => {
    ownerSpy.mockImplementation((address: string) =>
      Promise.resolve(address === ADDR_A ? portfolio([ASSET], ADDR_A) : portfolio([], ADDR_B)),
    );

    const { result, rerender } = renderHook(({ addr }) => usePortfolio(addr), {
      initialProps: { addr: ADDR_A },
    });
    await waitFor(() => expect(result.current.assets).toHaveLength(1));

    rerender({ addr: ADDR_B });
    expect(result.current.loaded).toBe(false);
    expect(result.current.assets).toEqual([]);

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.assets).toEqual([]);
    expect(result.current.available).toBe(true);
  });

  it('keeps last good list as stale when a later poll fails', async () => {
    ownerSpy.mockResolvedValueOnce(portfolio([ASSET])).mockRejectedValue(new Error('boom'));

    vi.useFakeTimers();
    const { result } = renderHook(() => usePortfolio(ADDR_A));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.assets).toHaveLength(1);
    expect(result.current.available).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current.assets).toHaveLength(1);
    expect(result.current.stale).toBe(true);
    expect(result.current.error).toMatch(/boom/);
    expect(result.current.available).toBe(false);
    expect(result.current.loaded).toBe(true);
  });

  it('first non-501 error sets error and does not claim available empty wallet', async () => {
    ownerSpy.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => usePortfolio(ADDR_A));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.assets).toEqual([]);
    expect(result.current.available).toBe(false);
    expect(result.current.error).toMatch(/down/);
    expect(result.current.unavailableReason).toBeNull();
  });

  it('surfaces available:false on 501 (not an empty wallet)', async () => {
    ownerSpy.mockRejectedValue(
      new ApiError(
        501,
        'portfolio not available in this build — AccountState balances decode is not wired yet',
      ),
    );
    const { result } = renderHook(() => usePortfolio(ADDR_A));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.available).toBe(false);
    expect(result.current.assets).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.unavailableReason).toMatch(/not available/i);
  });

  it('does not write state when the fetch resolves after unmount', async () => {
    let resolveFetch!: (v: OwnerBalanceResponse) => void;
    ownerSpy.mockReturnValue(
      new Promise<OwnerBalanceResponse>((res) => {
        resolveFetch = res;
      }),
    );

    const { unmount } = renderHook(() => usePortfolio(ADDR_A));
    expect(ownerSpy).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      resolveFetch(portfolio([ASSET]));
      await Promise.resolve();
    });

    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(ownerSpy).toHaveBeenCalledTimes(1);
  });

  it('does not write state when the fetch rejects after unmount', async () => {
    let rejectFetch!: (e: Error) => void;
    ownerSpy.mockReturnValue(
      new Promise<OwnerBalanceResponse>((_res, rej) => {
        rejectFetch = rej;
      }),
    );

    const { unmount } = renderHook(() => usePortfolio(ADDR_A));
    expect(ownerSpy).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      rejectFetch(new Error('late'));
      await Promise.resolve();
    });
    expect(ownerSpy).toHaveBeenCalledTimes(1);
  });
});
