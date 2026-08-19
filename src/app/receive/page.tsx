'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Wallet } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';

/**
 * Receive surface.
 *
 * Name claim + NIP-05 resolution are not wired on the closed /v1 surface
 * (`api.resolveUsername` → 501). Raw `zk1…` addresses are rejected by
 * `extractRecipient` / Send. Until a name or invoice credential path is
 * productively available, receive stays honestly unavailable — including
 * when the local account happens to store a `username` string (that alone
 * is not a Send-accepted contract without live resolution).
 */
export default function ReceivePage() {
  const router = useRouter();
  const t = useTranslations('receive');
  const { account } = useWalletStore();

  useEffect(() => {
    if (account) return;
    /* v8 ignore next -- This useEffect runs only after this client component mounts in a browser realm. */
    if (typeof window === 'undefined') return;
    useWalletStore.getState().restoreUnlockedSession();
    if (useWalletStore.getState().account) return;
    const id = setTimeout(() => {
      if (!useWalletStore.getState().account) router.replace('/');
    }, 100);
    return () => clearTimeout(id);
  }, [account, router]);

  if (!account) {
    return (
      <AppShell showNav={false}>
        <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
          <Wallet size={36} strokeWidth={1.75} className="text-ink4" />
          <p data-testid="redirecting-placeholder" className="mt-4 text-[14px] text-ink2">
            {t('redirecting')}
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell showNav={false}>
      <header className="flex items-center justify-between">
        <Link
          data-testid="receive-back-link"
          href="/"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink3 transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} strokeWidth={2} />
          {t('back')}
        </Link>
        <span className="text-[11px] font-medium tracking-wider text-ink3 uppercase">
          {t('heading')}
        </span>
      </header>

      <div className="mt-10 space-y-7">
        <div>
          <h1
            data-testid="receive-heading"
            className="text-[26px] font-bold tracking-tight text-ink"
          >
            {t('heading')}
          </h1>
          <p className="mt-1 text-[13px] text-ink2">{t('subtitle')}</p>
        </div>

        <div
          data-testid="receive-not-available"
          className="rounded-md border border-line2 bg-surface p-3 text-[12px] leading-relaxed text-ink2"
          role="status"
        >
          {t('unavailable')}
        </div>
      </div>
    </AppShell>
  );
}
