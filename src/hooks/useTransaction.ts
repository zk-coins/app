'use client';

import { useEffect, useState } from 'react';
import { ApiError, api, isAccountNotFoundError, type TxDetail } from '@/lib/api/client';

export type TxLoadError = 'not_found' | 'error' | 'wallet_unavailable';

export interface TxAccount {
  address: string;
  mnemonic: string;
  nkCommit: string;
}

export interface UseTransactionResult {
  detail: TxDetail | null;
  loading: boolean;
  error: TxLoadError | null;
}

/**
 * Server-truth detail for a single transaction via pull-session history.
 */
export function useTransaction(
  id: number | string | null,
  account: TxAccount | undefined,
): UseTransactionResult {
  const [detail, setDetail] = useState<TxDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<TxLoadError | null>(null);

  const address = account?.address;
  const mnemonic = account?.mnemonic;
  const nkCommit = account?.nkCommit;

  useEffect(() => {
    setDetail(null);
    setError(null);
    setLoading(true);

    // id and account are checked separately — missing wallet material is not
    // the same as a missing transaction.
    if (id === null) {
      setLoading(false);
      setError('not_found');
      return;
    }
    if (!address || !mnemonic || !nkCommit) {
      setLoading(false);
      setError('wallet_unavailable');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    api
      .getTransaction(
        id,
        { address, mnemonic, nkCommit, accountIndex: 0 },
        { signal: controller.signal },
      )
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoading(false);
        if (e instanceof ApiError && e.code === 'transaction_not_found') {
          setError('not_found');
          return;
        }
        if (
          isAccountNotFoundError(e) ||
          (e instanceof ApiError && e.status === 404 && e.code === 'not_found')
        ) {
          setError('error');
          return;
        }
        setError('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, address, mnemonic, nkCommit]);

  return { detail, loading, error };
}
