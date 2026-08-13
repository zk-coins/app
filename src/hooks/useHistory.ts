'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, api, type HistoryItem } from '@/lib/api/client';

/**
 * Poll cadence for pull-session history. Matched to the balance tick so
 * balance and history advance in lock-step.
 */
const HISTORY_POLL_MS = 5_000;

export interface HistoryAccount {
  address: string;
  mnemonic: string;
  nkCommit: string;
}

export interface UseHistoryResult {
  /** Server-owned transaction rows for the address, in the node's order. */
  items: HistoryItem[];
  /**
   * `false` until the first history round-trip settles (success *or*
   * failure). Lets the caller hold the empty state back during the initial
   * fetch instead of flashing "No transactions yet" before the list lands.
   */
  loaded: boolean;
  /**
   * true only after a successful history read. false when the first (or
   * only) read failed — empty-state copy must not render in that case.
   */
  available: boolean;
  /** Load failure message (network/auth/server). Null on success or park. */
  error: string | null;
  /**
   * true when `items` is from an earlier success and a later poll failed.
   */
  stale: boolean;
}

/**
 * Server-truth transaction history via the ownership pull session.
 * Passing `undefined` (no account yet) parks the hook.
 *
 * Failures are visible: only a successful response with `items=[]` may
 * drive the empty-history UI. A transport/auth/node error sets `error`
 * and keeps any prior list marked stale rather than inventing emptiness.
 */
export function useHistory(account: HistoryAccount | undefined): UseHistoryResult {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const hadSuccessRef = useRef(false);

  const address = account?.address;
  const mnemonic = account?.mnemonic;
  const nkCommit = account?.nkCommit;

  useEffect(() => {
    setItems([]);
    setLoaded(false);
    setAvailable(false);
    setError(null);
    setStale(false);
    hadSuccessRef.current = false;

    if (!address || !mnemonic || !nkCommit) return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const tick = async () => {
      try {
        const res = await api.getHistory(
          { address, mnemonic, nkCommit, accountIndex: 0 },
          { signal: controller.signal },
        );
        if (cancelled) return;
        setItems(res.items);
        setAvailable(true);
        setError(null);
        setStale(false);
        hadSuccessRef.current = true;
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? (err.serverError ?? err.message)
            : err instanceof Error
              ? err.message
              : String(err);
        setAvailable(false);
        setError(message);
        if (!hadSuccessRef.current) {
          setItems([]);
        } else {
          setStale(true);
        }
        setLoaded(true);
      }
    };
    const schedule = () => {
      void tick().finally(() => {
        if (!cancelled) timeout = setTimeout(schedule, HISTORY_POLL_MS);
      });
    };
    void schedule();
    return () => {
      cancelled = true;
      controller.abort();
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, [address, mnemonic, nkCommit]);

  return { items, loaded, available, error, stale };
}
