'use client';

import { useEffect, useState } from 'react';
import { ApiError, api, type AssetBalance } from '@/lib/api/client';

const PORTFOLIO_POLL_MS = 5_000;

export interface UsePortfolioResult {
  assets: AssetBalance[];
  loaded: boolean;
  /**
   * false when portfolio cannot be decoded yet (AccountState balances
   * path not wired). Distinguishes "not available in this build" from
   * a real empty wallet.
   */
  available: boolean;
  /** Human-readable reason when `available` is false. */
  unavailableReason: string | null;
}

/**
 * Multi-asset portfolio for `address`.
 *
 * v1 does not expose a legacy portfolio REST route; without an
 * AccountState balances decoder the API refuses (501). The hook surfaces
 * that as `available: false` so screens show an honest "not available"
 * state instead of an empty portfolio.
 */
export function usePortfolio(address: string | undefined): UsePortfolioResult {
  const [assets, setAssets] = useState<AssetBalance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

  useEffect(() => {
    setAssets([]);
    setLoaded(false);
    setAvailable(true);
    setUnavailableReason(null);

    if (!address) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.ownerBalances(address);
        if (cancelled) return;
        setAssets(res.assets);
        setAvailable(true);
        setUnavailableReason(null);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 501) {
          setAssets([]);
          setAvailable(false);
          setUnavailableReason(err.serverError ?? err.message);
        }
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

  return { assets, loaded, available, unavailableReason };
}
