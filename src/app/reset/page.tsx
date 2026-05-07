'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';

/**
 * Dev utility: clears all zkCoins localStorage and redirects to home,
 * which then shows the Welcome / Onboarding because no account exists.
 *
 * Visit /reset to "start fresh" without DevTools.
 */
export default function ResetPage() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith('zkcoins'))
      .forEach((k) => localStorage.removeItem(k));
    router.replace('/');
  }, [router]);

  return (
    <AppShell showNav={false}>
      <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
        <Loader2 size={28} strokeWidth={1.75} className="animate-spin text-ink3" />
        <p className="mt-4 text-[14px] text-ink2">Clearing local state…</p>
      </div>
    </AppShell>
  );
}
