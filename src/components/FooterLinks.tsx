'use client';

import Link from 'next/link';

interface LinkEntry {
  label: string;
  href: string;
  internal?: boolean;
}

const SHARED: LinkEntry[] = [{ label: 'GitHub', href: 'https://github.com/zk-coins' }];

// Internal add-ons sit at the very end of the bar, after the external links.
const ADDONS: LinkEntry[] = [{ label: 'Network', href: '/network', internal: true }];

const PRD_LINKS: LinkEntry[] = [
  { label: 'Docs', href: 'https://docs.zkcoins.app' },
  { label: 'API', href: 'https://github.com/DFXswiss/api' },
  { label: 'Explorer', href: 'https://explorer.zkcoins.app' },
  { label: 'Blog', href: 'https://blog.zkcoins.app' },
  { label: 'Status', href: 'https://status.zkcoins.app' },
  ...SHARED,
  ...ADDONS,
];

const DEV_LINKS: LinkEntry[] = [
  { label: 'Docs', href: 'https://dev-docs.zkcoins.app' },
  { label: 'API', href: 'https://github.com/DFXswiss/api' },
  { label: 'Explorer', href: 'https://dev-explorer.zkcoins.app' },
  { label: 'Blog', href: 'https://dev-blog.zkcoins.app' },
  { label: 'Status', href: 'https://dev-status.zkcoins.app' },
  ...SHARED,
  ...ADDONS,
];

function pickLinks(): LinkEntry[] {
  if (typeof window === 'undefined') return PRD_LINKS;
  return window.location.hostname.startsWith('dev') ? DEV_LINKS : PRD_LINKS;
}

/**
 * Inline list of resource links (docs, api, explorer, blog, status, github)
 * plus internal add-ons at the end. Two visual variants:
 *  - "row":   single-line dot-separated list (compact, for footers / under hero text)
 *  - "grid":  2-column grid for the Settings page
 */
export function FooterLinks({ variant = 'row' }: { variant?: 'row' | 'grid' }) {
  const links = pickLinks();

  if (variant === 'grid') {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {links.map((l) =>
          l.internal ? (
            <Link
              key={l.label}
              href={l.href}
              className="flex items-center justify-between rounded-md border border-line2 bg-surface px-3 py-2 text-[13px] text-ink2 transition-colors hover:border-bitcoin hover:text-bitcoin"
            >
              <span>{l.label}</span>
              <span className="text-ink4">→</span>
            </Link>
          ) : (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-md border border-line2 bg-surface px-3 py-2 text-[13px] text-ink2 transition-colors hover:border-bitcoin hover:text-bitcoin"
            >
              <span>{l.label}</span>
              <span className="text-ink4">↗</span>
            </a>
          ),
        )}
      </div>
    );
  }

  return (
    <nav
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px] text-ink3"
      aria-label="Resources"
    >
      {links.map((l, i) => (
        <span key={l.label} className="flex items-center gap-3">
          {l.internal ? (
            <Link href={l.href} className="transition-colors hover:text-bitcoin">
              {l.label}
            </Link>
          ) : (
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-bitcoin"
            >
              {l.label}
            </a>
          )}
          {i < links.length - 1 && <span className="text-ink4">·</span>}
        </span>
      ))}
    </nav>
  );
}
