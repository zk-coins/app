'use client';

import { useEffect, useState } from 'react';
import { ApiError, api, type TxDetail } from '@/lib/api/client';

export type TxLoadError = 'not_found' | 'error';

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

    if (id === null || !address || !mnemonic || !nkCommit) {
      setLoading(false);
      setError('not_found');
      return;
    }

    let cancelled = false;
    api
      .getTransaction(id, { address, mnemonic, nkCommit })
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoading(false);
        setError(e instanceof ApiError && e.status === 404 ? 'not_found' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [id, address, mnemonic, nkCommit]);

  return { detail, loading, error };
}
