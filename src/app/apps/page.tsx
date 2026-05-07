'use client';

import { Globe, Zap, ExternalLink, type LucideIcon } from 'lucide-react';
import { AppShell } from '@/components/AppShell';

interface AppEntry {
  name: string;
  tagline: string;
  description: string;
  url: string;
  badge: 'Live' | 'Soon';
  icon: LucideIcon;
}

const APPS: AppEntry[] = [
  {
    name: 'DFX',
    tagline: 'On & Off Ramp',
    description:
      'Buy private Bitcoin directly with EUR, CHF, or USD. Swiss-licensed, FINMA-regulated. Withdraw any time.',
    url: 'https://dfx.swiss',
    badge: 'Live',
    icon: Globe,
  },
  {
    name: 'Open Crypto Pay',
    tagline: 'Pay merchants without leaks',
    description:
      'Open standard for crypto-payments at the point of sale. Scan, pay privately, walk out — no PII shared.',
    url: 'https://opencryptopay.io',
    badge: 'Live',
    icon: Zap,
  },
];

export default function AppsPage() {
  return (
    <AppShell>
      <header className="space-y-1">
        <h1 className="text-[28px] font-bold tracking-tight text-ink">Apps</h1>
        <p className="text-[14px] text-ink2">Bitcoin tools that work with your zkCoins wallet.</p>
      </header>

      <div className="mt-8 space-y-3">
        {APPS.map((app) => {
          const Icon = app.icon;
          return (
            <a
              key={app.name}
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-4 rounded-md border border-line2 bg-surface p-4 transition-colors hover:border-bitcoin"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-bitcoin/30 bg-bitcoin/5 text-bitcoin">
                <Icon size={22} strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-1.5 text-[16px] font-semibold text-ink group-hover:text-bitcoin">
                      {app.name}
                      <ExternalLink
                        size={12}
                        strokeWidth={2}
                        className="text-ink4 group-hover:text-bitcoin"
                      />
                    </p>
                    <p className="text-[12px] tracking-wide text-ink3">{app.tagline}</p>
                  </div>
                  <span className="rounded-sm bg-bitcoin/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-bitcoin uppercase">
                    {app.badge}
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-ink2">{app.description}</p>
              </div>
            </a>
          );
        })}
      </div>

      <p className="mt-8 text-[12px] leading-relaxed text-ink3">
        Apps are external services. Keys never leave your browser — zkCoins doesn't share
        your private state with these integrations unless you explicitly approve a connection.
      </p>
    </AppShell>
  );
}
