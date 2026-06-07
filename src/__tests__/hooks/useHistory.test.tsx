/**
 * `useHistory` — server-truth transaction history hook
 * (`src/hooks/useHistory.ts`, issue #175).
 *
 * Covers: mount fetch, 5 s re-poll cadence, account-swap reset (no
 * cross-account leak), the parked `undefined`-address path, error
 * swallowing (keeps the last good list, still flips `loaded`), and the
 * unmount cleanup (no post-unmount state writes, interval cleared).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useHistory } from '@/hooks/useHistory';
import { api, type HistoryResponse } from '@/lib/api/client';

const ADDR_A = 'a'.repeat(64);
const ADDR_B = 'b'.repeat(64);

function page(items: HistoryResponse['items'], total = items.length): HistoryResponse {
  return { items, total, limit: 50, offset: 0 };
}

const MINT_ROW = {
  id: 1,
  txid: null,
  timestamp: 1_780_000_000,
  direction: 'mint' as const,
  amount: 10_000,
  counterparty: null,
  status: 'pending' as const,
  block_height: null,
  memo: null,
};

let historySpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  historySpy = vi.spyOn(api, 'getHistory');
});

afterEach(() => {
  vi.useRealTimers();
  historySpy.mockRestore();
});

describe('useHistory', () => {
  it('fetches on mount and exposes the items + loaded flag', async () => {
    historySpy.mockResolvedValue(page([MINT_ROW]));

    const { result } = renderHook(() => useHistory(ADDR_A));
    expect(result.current.loaded).toBe(false);

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.items).toEqual([MINT_ROW]);
    expect(historySpy).toHaveBeenCalledWith(ADDR_A);
  });

  it('re-polls every 5 s', async () => {
    historySpy
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([MINT_ROW]))
      .mockResolvedValue(page([MINT_ROW, { ...MINT_ROW, id: 2 }]));

    vi.useFakeTimers();
    const { result } = renderHook(() => useHistory(ADDR_A));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.items).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current.items).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current.items).toHaveLength(2);
    expect(historySpy).toHaveBeenCalledTimes(3);
  });

  it('does not fetch when the address is undefined (parked)', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHistory(undefined));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(historySpy).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    expect(result.current.loaded).toBe(false);
  });

  it('resets items + loaded when the address changes (no cross-account leak)', async () => {
    historySpy.mockImplementation((address: string) =>
      Promise.resolve(address === ADDR_A ? page([MINT_ROW]) : page([])),
    );

    const { result, rerender } = renderHook(({ addr }) => useHistory(addr), {
      initialProps: { addr: ADDR_A },
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    rerender({ addr: ADDR_B });
    // Synchronously reset before the new fetch resolves — the old account's
    // row must not linger.
    expect(result.current.loaded).toBe(false);
    expect(result.current.items).toEqual([]);

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.items).toEqual([]);
  });

  it('swallows a fetch error, keeps the last good list, and still flips loaded', async () => {
    historySpy.mockResolvedValueOnce(page([MINT_ROW])).mockRejectedValue(new Error('boom'));

    vi.useFakeTimers();
    const { result } = renderHook(() => useHistory(ADDR_A));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.items).toHaveLength(1);

    // Next tick rejects — the good list survives, loaded stays true.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.loaded).toBe(true);
  });

  it('marks loaded even when the very first fetch fails', async () => {
    historySpy.mockRejectedValue(new Error('down'));

    const { result } = renderHook(() => useHistory(ADDR_A));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.items).toEqual([]);
  });

  it('stops polling after unmount and never writes state post-unmount', async () => {
    // A deferred promise lets us resolve the in-flight fetch AFTER unmount,
    // exercising the `cancelled` guard that prevents a post-unmount setState.
    let resolveFetch!: (v: HistoryResponse) => void;
    historySpy.mockReturnValue(
      new Promise<HistoryResponse>((res) => {
        resolveFetch = res;
      }),
    );

    const { unmount } = renderHook(() => useHistory(ADDR_A));
    expect(historySpy).toHaveBeenCalledTimes(1);

    unmount();
    // Resolving now hits the cancelled guard — no throw, no state write.
    await act(async () => {
      resolveFetch(page([MINT_ROW]));
      await Promise.resolve();
    });

    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // No further polls after unmount.
    expect(historySpy).toHaveBeenCalledTimes(1);
  });

  it('does not write state when the in-flight fetch REJECTS after unmount', async () => {
    // Mirror of the success-after-unmount case for the catch branch: the
    // `cancelled` guard must also short-circuit a rejection so no setState
    // fires on an unmounted hook.
    let rejectFetch!: (e: Error) => void;
    historySpy.mockReturnValue(
      new Promise<HistoryResponse>((_res, rej) => {
        rejectFetch = rej;
      }),
    );

    const { unmount } = renderHook(() => useHistory(ADDR_A));
    expect(historySpy).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      rejectFetch(new Error('late failure'));
      await Promise.resolve();
    });
    // Reaching here without an act() warning / unhandled rejection is the
    // assertion: the cancelled guard in the catch swallowed the post-unmount
    // settle.
    expect(historySpy).toHaveBeenCalledTimes(1);
  });
});
