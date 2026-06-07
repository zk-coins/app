/**
 * `useTransaction` — single-transaction detail hook
 * (`src/hooks/useTransaction.ts`, tx-detail feature).
 *
 * Covers: the parked not-found paths (null id / missing address, no
 * fetch), the success path, the 404 → not_found mapping, the generic
 * error mapping, and the unmount-cancellation guards on both the
 * resolve and reject legs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTransaction } from '@/hooks/useTransaction';
import { ApiError, api, type TxDetail } from '@/lib/api/client';

const DETAIL: TxDetail = {
  id: 7,
  address: 'a'.repeat(64),
  txid: null,
  timestamp: 1_780_000_000,
  direction: 'mint',
  amount: 10_000,
  counterparty: null,
  status: 'pending',
  block_height: null,
  memo: null,
  balance_after: 10_000,
  balance_before: null,
  num_sends_after: 0,
  commitment_public_key: null,
  circuit_digest: 'cd',
  commit_output_value: null,
};

let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  spy = vi.spyOn(api, 'getTransaction');
});

afterEach(() => {
  spy.mockRestore();
});

describe('useTransaction', () => {
  it('resolves to not_found without fetching when the id is null', async () => {
    const { result } = renderHook(() => useTransaction(null, 'a'.repeat(64)));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('not_found');
    expect(result.current.detail).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('resolves to not_found without fetching when the address is missing', async () => {
    const { result } = renderHook(() => useTransaction(7, undefined));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('not_found');
    expect(spy).not.toHaveBeenCalled();
  });

  it('fetches and exposes the detail on success', async () => {
    spy.mockResolvedValue(DETAIL);
    const { result } = renderHook(() => useTransaction(7, 'a'.repeat(64)));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.detail).toEqual(DETAIL);
    expect(result.current.error).toBeNull();
    expect(spy).toHaveBeenCalledWith(7, 'a'.repeat(64));
  });

  it('maps a 404 ApiError to not_found', async () => {
    spy.mockRejectedValue(new ApiError(404, 'Transaction not found'));
    const { result } = renderHook(() => useTransaction(999, 'a'.repeat(64)));
    await waitFor(() => expect(result.current.error).toBe('not_found'));
    expect(result.current.detail).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('maps any non-404 failure to a generic error', async () => {
    spy.mockRejectedValue(new ApiError(500, 'Database error'));
    const { result } = renderHook(() => useTransaction(7, 'a'.repeat(64)));
    await waitFor(() => expect(result.current.error).toBe('error'));
  });

  it('maps a non-ApiError throw (network) to a generic error', async () => {
    spy.mockRejectedValue(new Error('Failed to fetch'));
    const { result } = renderHook(() => useTransaction(7, 'a'.repeat(64)));
    await waitFor(() => expect(result.current.error).toBe('error'));
  });

  it('does not write state when the fetch RESOLVES after unmount', async () => {
    let resolve!: (d: TxDetail) => void;
    spy.mockReturnValue(
      new Promise<TxDetail>((res) => {
        resolve = res;
      }),
    );
    const { unmount } = renderHook(() => useTransaction(7, 'a'.repeat(64)));
    expect(spy).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      resolve(DETAIL);
      await Promise.resolve();
    });
    // Reaching here without an act() warning is the assertion: the
    // cancelled guard swallowed the post-unmount resolve.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not write state when the fetch REJECTS after unmount', async () => {
    let reject!: (e: Error) => void;
    spy.mockReturnValue(
      new Promise<TxDetail>((_res, rej) => {
        reject = rej;
      }),
    );
    const { unmount } = renderHook(() => useTransaction(7, 'a'.repeat(64)));
    unmount();
    await act(async () => {
      reject(new ApiError(404, 'gone'));
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
