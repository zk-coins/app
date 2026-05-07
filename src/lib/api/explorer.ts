/**
 * Thin client for the zkCoins explorer. The endpoint does not exist yet —
 * when NEXT_PUBLIC_EXPLORER_URL is unset (the default in dev) or the request
 * fails, we transparently fall back to the local simulator so the UI stays
 * usable during the preview phase.
 */

import { buildHistory, type NetworkSample } from '@/lib/simulate-network';

export interface NetworkActivity {
  samples: NetworkSample[];
  source: 'explorer' | 'simulated';
}

const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL ?? '';

export async function getNetworkActivity({
  windowMs = 60 * 60 * 1000,
  signal,
}: { windowMs?: number; signal?: AbortSignal } = {}): Promise<NetworkActivity> {
  if (EXPLORER_URL) {
    try {
      const url = `${EXPLORER_URL.replace(/\/$/, '')}/network/activity?window_ms=${windowMs}`;
      const res = await fetch(url, { signal });
      if (res.ok) {
        const data = (await res.json()) as { samples: NetworkSample[] };
        if (Array.isArray(data.samples) && data.samples.length > 0) {
          return { samples: data.samples, source: 'explorer' };
        }
      }
    } catch {
      // network/parse error → fall through to simulator
    }
  }

  return {
    samples: buildHistory({ spanMs: windowMs }),
    source: 'simulated',
  };
}
