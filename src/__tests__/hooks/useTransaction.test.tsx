/**
 * `useTransaction` — single-transaction detail via pull-session history.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
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

  it('resolves wallet_unavailable when account is missing', async () => {
    const { result } = renderHook(() => useTransaction(7, undefined));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('wallet_unavailable');
    expect(spy).not.toHaveBeenCalled();
  });

  it('resolves wallet_unavailable when mnemonic is missing', async () => {
    const { result } = renderHook(() => useTransaction(7, { ...ACCOUNT, mnemonic: '' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('wallet_unavailable');
    expect(spy).not.toHaveBeenCalled();
  });

  it('resolves wallet_unavailable when nkCommit is missing', async () => {
    const { result } = renderHook(() => useTransaction(7, { ...ACCOUNT, nkCommit: '' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('wallet_unavailable');
    expect(spy).not.toHaveBeenCalled();
  });

  it('loads detail for a valid id', async () => {
    spy.mockResolvedValue(DETAIL);
    const { result } = renderHook(() => useTransaction('r1', ACCOUNT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.detail).toEqual(DETAIL);
    expect(spy).toHaveBeenCalledWith('r1', ACCOUNT);
  });

  it('maps transaction_not_found to not_found', async () => {
    spy.mockRejectedValue(
      new ApiError(404, 'transaction not found', undefined, 'transaction_not_found'),
    );
    const { result } = renderHook(() => useTransaction('missing', ACCOUNT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('not_found');
  });

  it('maps account not_found 404 to error, not tx-missing', async () => {
    spy.mockRejectedValue(new ApiError(404, 'Unknown account address', undefined, 'not_found'));
    const { result } = renderHook(() => useTransaction('r1', ACCOUNT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('error');
  });

  it('maps bare 404 without transaction_not_found to error', async () => {
    spy.mockRejectedValue(new ApiError(404, 'gone'));
    const { result } = renderHook(() => useTransaction('r1', ACCOUNT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('error');
  });

  it('maps other failures to error', async () => {
    spy.mockRejectedValue(new ApiError(500, 'internal_error'));
    const { result } = renderHook(() => useTransaction('r1', ACCOUNT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('error');
  });

  it('does not write state when success resolves after unmount', async () => {
    let resolveFetch!: (v: TxDetail) => void;
    spy.mockReturnValue(
      new Promise<TxDetail>((res) => {
        resolveFetch = res;
      }),
    );
    const { unmount } = renderHook(() => useTransaction('r1', ACCOUNT));
    unmount();
    await act(async () => {
      resolveFetch(DETAIL);
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not write state when rejection lands after unmount', async () => {
    let rejectFetch!: (e: unknown) => void;
    spy.mockReturnValue(
      new Promise<TxDetail>((_res, rej) => {
        rejectFetch = rej;
      }),
    );
    const { unmount } = renderHook(() => useTransaction('r1', ACCOUNT));
    unmount();
    await act(async () => {
      rejectFetch(new ApiError(500, 'late'));
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
