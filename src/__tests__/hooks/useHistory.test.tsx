/**
 * `useHistory` — pull-session history hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useHistory } from '@/hooks/useHistory';
import { api, type HistoryResponse } from '@/lib/api/client';

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
    expect(spy).toHaveBeenCalledWith(ACCOUNT);
  });

  it('parks when account is undefined', async () => {
    const { result } = renderHook(() => useHistory(undefined));
    expect(result.current.loaded).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('marks loaded on error without clearing later successes', async () => {
    spy.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useHistory(ACCOUNT));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.items).toEqual([]);
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
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(other));
  });
});
