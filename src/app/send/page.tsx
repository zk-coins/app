'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Wallet } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';

/**
 * `useSearchParams()` used to opt the multi-asset send route into CSR.
 * Send is fail-closed until input-coin selection ships, so both surfaces
 * share one honest "not available yet" page — no empty-input POST to /v1/tx.
 */
export default function SendPage() {
  return (
    <Suspense fallback={null}>
      <SendUnavailablePage />
    </Suspense>
  );
}

function SendUnavailablePage() {
  const router = useRouter();
  const t = useTranslations('send');
  const account = useWalletStore((s) => s.account);

  useEffect(() => {
    if (!account && typeof window !== 'undefined') {
      const id = setTimeout(() => {
        if (!useWalletStore.getState().account) router.replace('/');
      }, 100);
      return () => clearTimeout(id);
    }
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
          href="/"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink3 transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} strokeWidth={2} />
          {t('back')}
        </Link>
        <span className="text-[11px] font-medium tracking-wider text-ink3 uppercase">
          {t('eyebrow')}
        </span>
      </header>

      <div className="mt-10 space-y-6">
        <div>
          <h1 data-testid="send-heading" className="text-[26px] font-bold tracking-tight text-ink">
            {t('heading')}
          </h1>
          <p className="mt-1 text-[13px] text-ink2">{t('subtitle')}</p>
        </div>

        <div
          data-testid="send-unavailable-banner"
          className="rounded-md border border-line2 bg-surface p-4"
          role="status"
        >
          <p className="text-[14px] font-semibold text-ink">{t('unavailableTitle')}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink2">{t('unavailableBody')}</p>
        </div>

        {/* Keep submit control present but permanently disabled so tests
            and a11y still find the control; no network path is reachable. */}
        <button
          type="button"
          data-testid="send-submit-btn"
          disabled
          className="w-full cursor-not-allowed rounded-md bg-line py-4 text-[14px] font-semibold tracking-tight text-ink4"
        >
          {t('sendPrivately')}
        </button>
      </div>
    </AppShell>
  );
}
