'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { NetworkActivity } from '@/components/NetworkActivity';
import { getNetworkActivity } from '@/lib/api/explorer';
import { nextSample, type NetworkSample } from '@/lib/simulate-network';

const POLL_MS = 8000; // refresh cadence — slow enough to feel calm
const WINDOW_MS = 6 * 60 * 60 * 1000; // chart spans the last 6 hours

export default function NetworkPage() {
  const [samples, setSamples] = useState<NetworkSample[]>([]);
  const [source, setSource] = useState<'explorer' | 'simulated'>('simulated');
  const [loaded, setLoaded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initial fetch
  useEffect(() => {
    const ac = new AbortController();
    getNetworkActivity({ windowMs: WINDOW_MS, signal: ac.signal })
      .then((res) => {
        setSamples(res.samples);
        setSource(res.source);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => ac.abort();
  }, []);

  // Live updates: when running on simulated data, we tick locally; when wired
  // to the real explorer we re-fetch the tail. Either way the chart breathes.
  useEffect(() => {
    if (!loaded || samples.length === 0) return;

    intervalRef.current = setInterval(() => {
      if (source === 'explorer') {
        getNetworkActivity({ windowMs: WINDOW_MS }).then((res) => {
          if (res.samples.length > 0) setSamples(res.samples);
          setSource(res.source);
        });
      } else {
        setSamples((prev) => {
          const head = prev.slice(1);
          return [...head, nextSample(prev)];
        });
      }
    }, POLL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loaded, source, samples.length]);

  return (
    <AppShell>
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink3 transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} strokeWidth={2} />
          Back
        </Link>
        <span className="mono text-[11px] font-medium tracking-wider text-ink3 uppercase">
          Add-on
        </span>
      </header>

      <div className="mt-8 space-y-6">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink">Network activity</h1>
          <p className="mt-1 text-[13px] text-ink2">
            Live throughput across the zkCoins network. IN is proof traffic from clients; OUT is
            state broadcasts back to them.
          </p>
        </div>

        {loaded ? (
          <NetworkActivity samples={samples} />
        ) : (
          <div className="h-[360px] rounded-xl border border-line2 bg-surface" />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-ink3">
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                source === 'explorer' ? 'bg-bitcoin animate-pulse' : 'bg-ink4'
              }`}
            />
            <span className="mono tracking-wider uppercase">
              {source === 'explorer'
                ? `Live · 6h window · ${POLL_MS / 1000}s refresh`
                : 'Preview · simulated · 6h window'}
            </span>
          </div>
          <a
            href="https://github.com/zk-coins/explorer"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-ink"
          >
            zkCoins Explorer
            <ExternalLink size={11} strokeWidth={2} />
          </a>
        </div>

        {source === 'simulated' && (
          <p className="rounded-md border border-line2 bg-bg p-3 text-[11px] leading-relaxed text-ink3">
            The zkCoins explorer is not yet live. This panel is wired to the real endpoint at{' '}
            <span className="mono text-ink2">/network/activity</span> and will switch to real data
            automatically once <span className="mono text-ink2">NEXT_PUBLIC_EXPLORER_URL</span> is
            set and the endpoint responds. Until then the chart shows a deterministic 6-hour
            simulation that ticks every {POLL_MS / 1000}s.
          </p>
        )}
      </div>
    </AppShell>
  );
}
