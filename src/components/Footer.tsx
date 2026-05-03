'use client';

const SHARED_LINKS = [{ label: 'GitHub', href: 'https://github.com/zk-coins' }];

const PRD_LINKS = [
  { label: 'Docs', href: 'https://docs.zkcoins.app' },
  { label: 'API', href: 'https://api.zkcoins.app' },
  { label: 'Explorer', href: 'https://explorer.zkcoins.app' },
  { label: 'Blog', href: 'https://blog.zkcoins.app' },
  { label: 'Status', href: 'https://status.zkcoins.app' },
  ...SHARED_LINKS,
];

const DEV_LINKS = [
  { label: 'Docs', href: 'https://dev-docs.zkcoins.app' },
  { label: 'API', href: 'https://dev-api.zkcoins.app' },
  { label: 'Explorer', href: 'https://dev-explorer.zkcoins.app' },
  { label: 'Blog', href: 'https://dev-blog.zkcoins.app' },
  { label: 'Status', href: 'https://dev-status.zkcoins.app' },
  ...SHARED_LINKS,
];

function useLinks() {
  if (typeof window === 'undefined') return PRD_LINKS;
  return window.location.hostname.startsWith('dev') ? DEV_LINKS : PRD_LINKS;
}

export function Footer() {
  const links = useLinks();

  return (
    <footer className="mt-12 border-t border-zkcoins-border pt-6 pb-8">
      <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2">
        {links.map(({ label, href }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-zkcoins-muted transition-colors hover:text-bitcoin"
          >
            {label}
          </a>
        ))}
      </nav>
    </footer>
  );
}
