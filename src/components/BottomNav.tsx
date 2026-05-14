'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wallet, Boxes, Settings, type LucideIcon } from 'lucide-react';
import { FEATURES } from '@/lib/features';

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Wallet', icon: Wallet },
  ...(FEATURES.APPS_DIRECTORY ? [{ href: '/apps', label: 'Apps', icon: Boxes }] : []),
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-1/2 z-50 mb-6 -translate-x-1/2 rounded-full border border-line2 bg-surface/95 px-2 py-2 backdrop-blur-md">
      <ul className="flex items-center gap-1">
        {TABS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || (href !== '/' && pathname.startsWith(href));
          return (
            <li key={href}>
              <Link
                href={href}
                className={`flex items-center gap-2 rounded-full px-4 py-2 transition-colors ${
                  isActive ? 'bg-bitcoin text-bg' : 'text-ink2 hover:bg-line hover:text-ink'
                }`}
              >
                <Icon size={16} strokeWidth={2} />
                <span
                  className={`text-[12px] tracking-wide ${
                    isActive ? 'font-semibold' : 'font-medium'
                  }`}
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
