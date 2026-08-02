'use client';

import { useEffect, useState } from 'react';
import { api, type HistoryItem } from '@/lib/api/client';

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
}

/**
 * Server-truth transaction history via the ownership pull session.
 * Passing `undefined` (no account yet) parks the hook.
 */
export function useHistory(account: HistoryAccount | undefined): UseHistoryResult {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const address = account?.address;
  const mnemonic = account?.mnemonic;
  const nkCommit = account?.nkCommit;

  useEffect(() => {
    setItems([]);
    setLoaded(false);

    if (!address || !mnemonic || !nkCommit) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.getHistory({ address, mnemonic, nkCommit });
        if (cancelled) return;
        setItems(res.items);
        setLoaded(true);
      } catch {
        if (cancelled) return;
        setLoaded(true);
      }
    };

    tick();
    const interval = setInterval(tick, HISTORY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, mnemonic, nkCommit]);

  return { items, loaded };
}
