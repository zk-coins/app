/**
 * `useHistory` — fail-loud pull-session history hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useHistory } from '@/hooks/useHistory';
import { ApiError, api, type HistoryResponse } from '@/lib/api/client';

const ACCOUNT = {
  address: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};

const empty: HistoryResponse = { items: [], total: 0, limit: 50, offset: 0 };

let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  spy = vi.spyOn(api, 'getHistory');
});

afterEach(() => {
  spy.mockRestore();
  vi.useRealTimers();
});

describe('useHistory', () => {
  it('fetches history for the account on mount', async () => {
    spy.mockResolvedValue({
      items: [{ id: 'r1', kind: 'send' }],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const { result } = renderHook(() => useHistory(ACCOUNT));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.available).toBe(true);
    expect(result.current.error).toBeNull();
    expect(spy).toHaveBeenCalledWith(
      { ...ACCOUNT, accountIndex: 0 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('parks when account is undefined', async () => {
    const { result } = renderHook(() => useHistory(undefined));
    expect(result.current.loaded).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(result.current.available).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('first error sets error and does not claim available empty history', async () => {
    spy.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useHistory(ACCOUNT));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.items).toEqual([]);
    expect(result.current.available).toBe(false);
    expect(result.current.error).toMatch(/network/);
  });

  it('successful empty response is available with no error', async () => {
    spy.mockResolvedValue(empty);
    const { result } = renderHook(() => useHistory(ACCOUNT));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.items).toEqual([]);
    expect(result.current.available).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('keeps last good list as stale when a later poll fails', async () => {
    spy
      .mockResolvedValueOnce({
        items: [{ id: 'r1', kind: 'mint' }],
        total: 1,
        limit: 50,
        offset: 0,
      })
      .mockRejectedValue(new Error('down'));

    vi.useFakeTimers();
    const { result } = renderHook(() => useHistory(ACCOUNT));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.items).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.stale).toBe(true);
    expect(result.current.available).toBe(false);
    expect(result.current.error).toMatch(/down/);
  });

  it('re-fetches when the account address changes', async () => {
    spy.mockResolvedValue(empty);
    const { result, rerender } = renderHook(({ acc }) => useHistory(acc), {
      initialProps: { acc: ACCOUNT as typeof ACCOUNT | undefined },
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const other = {
      ...ACCOUNT,
      address: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpr',
    };
    rerender({ acc: other });
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith(
        { ...other, accountIndex: 0 },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it('surfaces ApiError.serverError (or message) on first failure', async () => {
    spy.mockRejectedValue(new ApiError(503, 'node_unavailable'));
    const { result } = renderHook(() => useHistory(ACCOUNT));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.error).toBe('node_unavailable');
    expect(result.current.available).toBe(false);
  });

  it('falls back to ApiError.message when serverError is omitted', async () => {
    spy.mockRejectedValue(new ApiError(502));
    const { result } = renderHook(() => useHistory(ACCOUNT));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.error).toBe('HTTP 502');
  });

  it('stringifies non-Error rejections', async () => {
    spy.mockRejectedValue('raw-history-failure');
    const { result } = renderHook(() => useHistory(ACCOUNT));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.error).toBe('raw-history-failure');
  });

  it('does not write state when a success resolves after unmount', async () => {
    let resolveFetch!: (v: HistoryResponse) => void;
    spy.mockReturnValue(
      new Promise<HistoryResponse>((res) => {
        resolveFetch = res;
      }),
    );
    const { unmount } = renderHook(() => useHistory(ACCOUNT));
    unmount();
    await act(async () => {
      resolveFetch({ items: [{ id: 'late', kind: 'mint' }], total: 1, limit: 50, offset: 0 });
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not write state when a rejection lands after unmount', async () => {
    let rejectFetch!: (e: unknown) => void;
    spy.mockReturnValue(
      new Promise<HistoryResponse>((_res, rej) => {
        rejectFetch = rej;
      }),
    );
    const { unmount } = renderHook(() => useHistory(ACCOUNT));
    unmount();
    await act(async () => {
      rejectFetch(new Error('late'));
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('aborts in-flight getHistory on unmount without committing error state', async () => {
    let rejectFetch!: (e: unknown) => void;
    spy.mockReturnValue(
      new Promise<HistoryResponse>((_res, rej) => {
        rejectFetch = rej;
      }),
    );
    const { result, unmount } = renderHook(() => useHistory(ACCOUNT));
    expect(spy).toHaveBeenCalledWith(
      { ...ACCOUNT, accountIndex: 0 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    unmount();
    await act(async () => {
      rejectFetch(new DOMException('Aborted', 'AbortError'));
      await Promise.resolve();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.loaded).toBe(false);
    expect(result.current.available).toBe(false);
  });
});
