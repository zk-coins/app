'use client';

import { useEffect, useState } from 'react';
import { api, type AssetBalance } from '@/lib/api/client';

/**
 * Poll cadence for `GET /api/balance/:address`. Matched to the history
 * tick in `useHistory` so balance and history advance in lock-step.
 */
const PORTFOLIO_POLL_MS = 5_000;

export interface UsePortfolioResult {
  /** One entry per asset the owner holds, in the node's order. */
  assets: AssetBalance[];
  /**
   * `false` until the first `/api/balance/:address` round-trip settles
   * (success *or* failure). Lets the caller hold the empty state back
   * during the initial fetch instead of flashing "No assets yet".
   */
  loaded: boolean;
}

/**
 * Server-truth multi-asset portfolio for `address`.
 *
 * Fetches `GET /api/balance/:address` on mount and re-polls on a 5 s
 * cadence so a fresh create-coin mint, an inbound receive, or a send from
 * any tab/device surfaces without local bookkeeping (thin-client). A
 * failed fetch is swallowed and never clears already-rendered rows —
 * drift always resolves toward server truth on the next poll. Passing
 * `undefined` (no account yet) parks the hook: no fetch, empty list,
 * `loaded` stays `false`.
 */
export function usePortfolio(address: string | undefined): UsePortfolioResult {
  const [assets, setAssets] = useState<AssetBalance[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setAssets([]);
    setLoaded(false);

    if (!address) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.ownerBalances(address);
        if (cancelled) return;
        setAssets(res.assets);
        setLoaded(true);
      } catch {
        if (cancelled) return;
        setLoaded(true);
      }
    };

    tick();
    const interval = setInterval(tick, PORTFOLIO_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address]);

  return { assets, loaded };
}
