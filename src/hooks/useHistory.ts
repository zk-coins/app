'use client';

import { useEffect, useState } from 'react';
import { api, type HistoryItem } from '@/lib/api/client';

/**
 * Poll cadence for `GET /api/history`. Matched to the `/api/balance` tick in
 * `WalletScreen` so balance and history advance in lock-step.
 */
const HISTORY_POLL_MS = 5_000;

export interface UseHistoryResult {
  /** Server-owned transaction rows for the address, in the node's order. */
  items: HistoryItem[];
  /**
   * `false` until the first `/api/history` round-trip settles (success *or*
   * failure). Lets the caller hold the empty state back during the initial
   * fetch instead of flashing "No transactions yet" before the list lands.
   */
  loaded: boolean;
}

/**
 * Server-truth transaction history for `address`.
 *
 * Fetches `GET /api/history` on mount and re-polls on the same 5 s cadence as
 * the balance tick, so a faucet mint, an inbound receive, or a send from any
 * tab/device surfaces without any local bookkeeping. This is the thin-client
 * replacement for the retired `zkcoins_transactions` localStorage cache: the
 * App holds no transaction-history-truth of its own (see CONTRIBUTING.md
 * § Architecture Principle — Thin Client).
 *
 * A failed fetch is swallowed and never clears already-rendered rows — drift
 * always resolves toward server truth on the next poll, never toward a blank
 * list. Passing `undefined` (no account yet) parks the hook: no fetch, empty
 * list, `loaded` stays `false`.
 */
export function useHistory(address: string | undefined): UseHistoryResult {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Reset to the loading state whenever the address changes (account swap,
    // restore) so the previous account's rows can never leak into the new one.
    setItems([]);
    setLoaded(false);

    if (!address) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.getHistory(address);
        if (cancelled) return;
        setItems(res.items);
        setLoaded(true);
      } catch {
        // Transient — keep the last good list and retry on the next tick.
        // Still mark loaded so the caller drops the initial loading frame and
        // shows the empty state, which self-heals once a tick succeeds.
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
  }, [address]);

  return { items, loaded };
}
