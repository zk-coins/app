'use client';

import { useEffect, useState } from 'react';
import { ApiError, api, type TxDetail } from '@/lib/api/client';

/** Why a transaction-detail load did not produce a row. */
export type TxLoadError = 'not_found' | 'error';

export interface UseTransactionResult {
  /** The server's transaction detail, or `null` while loading / on error. */
  detail: TxDetail | null;
  /** `true` until the single `/api/history/{id}` fetch settles. */
  loading: boolean;
  /**
   * `'not_found'` — the row does not exist or does not belong to this
   * address (node 404), or the route/account inputs are missing.
   * `'error'` — any other failure (network, malformed response).
   * `null` while loading or once a detail has loaded.
   */
  error: TxLoadError | null;
}

/**
 * Server-truth detail for a single transaction — `GET /api/history/{id}`
 * via the typed SDK adapter (`api.getTransaction`). Fetches once when
 * `id` / `address` resolve; there is no local transaction store (issue
 * #175) and no polling — the detail is opened from the wallet list,
 * which already polls, so a one-shot fetch keeps the page simple and the
 * thin-client invariant intact.
 *
 * `id === null` (an unparseable route param) or a missing `address` (no
 * unlocked wallet) resolve immediately to `not_found` rather than firing
 * a doomed request.
 */
export function useTransaction(
  id: number | null,
  address: string | undefined,
): UseTransactionResult {
  const [detail, setDetail] = useState<TxDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<TxLoadError | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setLoading(true);

    if (id === null || !address) {
      setLoading(false);
      setError('not_found');
      return;
    }

    let cancelled = false;
    api
      .getTransaction(id, address)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoading(false);
        // A 404 is a terminal not-found (unknown id, or the row belongs
        // to another address); anything else is a transient/transport
        // error the user can retry by reopening.
        setError(e instanceof ApiError && e.status === 404 ? 'not_found' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [id, address]);

  return { detail, loading, error };
}
