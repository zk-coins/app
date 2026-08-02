'use client';

import { useEffect, useState } from 'react';
import { api, type AssetBalance } from '@/lib/api/client';

const PORTFOLIO_POLL_MS = 5_000;

export interface UsePortfolioResult {
  assets: AssetBalance[];
  loaded: boolean;
}

/**
 * Multi-asset portfolio for `address`.
 *
 * v1 does not expose the legacy portfolio REST route; without an
 * AccountState balances decoder this returns an empty list fail-closed
 * (never invents balances). The hook keeps the same contract so screens
 * continue to mount and the empty state is honest.
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
