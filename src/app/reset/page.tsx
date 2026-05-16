'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { notFound } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { deleteCredential } from '@/lib/crypto/storage';
import { FEATURES } from '@/lib/features';

/**
 * Dev utility: clears all zkCoins wallet data (IndexedDB + localStorage)
 * and redirects to home, which then shows the Welcome / Onboarding.
 *
 * Visit /reset to "start fresh" without DevTools.
 *
 * Gated by `NEXT_PUBLIC_ENABLE_DEV_ROUTES`. When the flag is statically
 * `false` at build time, `notFound()` short-circuits before any wallet code
 * executes — the gated code path cannot run, regardless of how the route
 * is reached.
 */
export default function ResetPage() {
  if (!FEATURES.DEV_ROUTES) notFound();

  const router = useRouter();
  const { deleteWallet } = useWalletStore();
  const { reset: resetAuth } = useAuthStore();

  useEffect(() => {
    (async () => {
      await deleteWallet();
      await deleteCredential();
      resetAuth();
      router.replace('/');
    })();
  }, [deleteWallet, resetAuth, router]);

  return (
    <AppShell showNav={false}>
      <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
        <Loader2 size={28} strokeWidth={1.75} className="animate-spin text-ink3" />
        <p className="mt-4 text-[14px] text-ink2">Clearing wallet data…</p>
      </div>
    </AppShell>
  );
}
