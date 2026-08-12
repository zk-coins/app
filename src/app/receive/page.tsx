'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  const { account } = useWalletStore();

  useEffect(() => {
    if (
      !account &&
      /* v8 ignore next -- This useEffect runs only after this client component mounts in a browser realm. */
      typeof window !== 'undefined'
    ) {
      const t = setTimeout(() => {
        if (!useWalletStore.getState().account) router.replace('/');
      }, 100);
      return () => clearTimeout(t);
    }
  }, [account, router]);

  if (!account) {
    return (
      <AppShell showNav={false}>
        <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
          <Wallet size={36} strokeWidth={1.75} className="text-ink4" />
          <p data-testid="redirecting-placeholder" className="mt-4 text-[14px] text-ink2">
            Redirecting to wallet…
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
          Back
        </Link>
        <span className="text-[11px] font-medium tracking-wider text-ink3 uppercase">Receive</span>
      </header>

      <div className="mt-10 space-y-7">
        <div>
          <h1
            data-testid="receive-heading"
            className="text-[26px] font-bold tracking-tight text-ink"
          >
            Receive
          </h1>
          <p className="mt-1 text-[13px] text-ink2">
            Name-based receive is not available yet in this build. Raw account addresses are not a
            valid Send recipient, so no QR is offered.
          </p>
        </div>

        <div
          data-testid="receive-not-available"
          className="rounded-md border border-line2 bg-surface p-3 text-[12px] leading-relaxed text-ink2"
          role="status"
        >
          Receive is not available yet — NIP-05 / name claim is not wired, and the Send path rejects
          raw <span className="mono">zk1…</span> addresses. No shareable payload is offered until a
          name or invoice credential can be resolved productively.
        </div>
      </div>
    </AppShell>
  );
}
