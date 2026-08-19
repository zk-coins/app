'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, api, type AssetBalance } from '@/lib/api/client';

const PORTFOLIO_POLL_MS = 5_000;

export interface UsePortfolioResult {
  assets: AssetBalance[];
  loaded: boolean;
  /**
   * true only after a successful portfolio read. false when the path is
   * not wired (501) or any other read failure prevents a trustworthy list.
   * Distinguishes "not available / error" from a real empty wallet.
   */
  available: boolean;
  /** Human-readable reason when the path is intentionally unavailable (501). */
  unavailableReason: string | null;
  /**
   * Transport/auth/parse/server error message when a read failed for a
   * reason other than intentional unavailability. Empty-state UI must not
   * render while this is set (unless a prior successful list is kept as stale).
   */
  error: string | null;
  /**
   * true when `assets` comes from an earlier successful read and a later
   * poll failed — list may be outdated.
   */
  stale: boolean;
}

/**
 * Multi-asset portfolio for `address`.
 *
 * v1 does not expose a legacy portfolio REST route; without an
 * AccountState balances decoder the API refuses (501). The hook surfaces
 * that as `available: false` so screens show an honest "not available"
 * state instead of an empty portfolio. Other failures set `error` and
 * never masquerade as a confirmed empty wallet.
 */
export function usePortfolio(address: string | undefined): UsePortfolioResult {
  const [assets, setAssets] = useState<AssetBalance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const hadSuccessRef = useRef(false);

  useEffect(() => {
    setAssets([]);
    setLoaded(false);
    setAvailable(false);
    setUnavailableReason(null);
    setError(null);
    setStale(false);
    hadSuccessRef.current = false;

    if (!address) return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await api.ownerBalances(address);
        if (cancelled) return;
        setAssets(res.assets);
        setAvailable(true);
        setUnavailableReason(null);
        setError(null);
        setStale(false);
        hadSuccessRef.current = true;
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 501) {
          setAvailable(false);
          setUnavailableReason(err.serverError ?? err.message);
          setError(null);
          if (!hadSuccessRef.current) {
            setAssets([]);
          } else {
            setStale(true);
          }
        } else {
          const message = err instanceof Error ? err.message : String(err);
          setAvailable(false);
          setUnavailableReason(null);
          setError(message);
          if (!hadSuccessRef.current) {
            setAssets([]);
          } else {
            setStale(true);
          }
        }
        setLoaded(true);
      }
    };
    const schedule = () => {
      void tick().finally(() => {
        if (!cancelled) timeout = setTimeout(schedule, PORTFOLIO_POLL_MS);
      });
    };
    void schedule();
    return () => {
      cancelled = true;
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, [address]);

  return { assets, loaded, available, unavailableReason, error, stale };
}
