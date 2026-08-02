/**
 * `useTransaction` — single-transaction detail via pull-session history.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTransaction } from '@/hooks/useTransaction';
import { ApiError, api, type TxDetail } from '@/lib/api/client';

const ACCOUNT = {
  address: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};

const DETAIL: TxDetail = { id: 'r1', kind: 'send', status: 'completed' };

let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  spy = vi.spyOn(api, 'getTransaction');
});

afterEach(() => {
  spy.mockRestore();
});

describe('useTransaction', () => {
  it('resolves not_found when id is null', async () => {
    const { result } = renderHook(() => useTransaction(null, ACCOUNT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('not_found');
    expect(spy).not.toHaveBeenCalled();
  });

  it('resolves not_found when account is missing', async () => {
    const { result } = renderHook(() => useTransaction(7, undefined));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('not_found');
  });

  it('loads detail for a valid id', async () => {
    spy.mockResolvedValue(DETAIL);
    const { result } = renderHook(() => useTransaction('r1', ACCOUNT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.detail).toEqual(DETAIL);
    expect(spy).toHaveBeenCalledWith('r1', ACCOUNT);
  });

  it('maps 404 to not_found', async () => {
    spy.mockRejectedValue(new ApiError(404, 'not_found'));
    const { result } = renderHook(() => useTransaction('missing', ACCOUNT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('not_found');
  });

  it('maps other failures to error', async () => {
    spy.mockRejectedValue(new ApiError(500, 'internal_error'));
    const { result } = renderHook(() => useTransaction('r1', ACCOUNT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('error');
  });
});
