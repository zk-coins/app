'use client';

import { useCallback, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, Copy, Check, Wallet } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { toZkAddress } from '@/lib/format';

export default function ReceivePage() {
  const router = useRouter();
  const { account } = useWalletStore();
  const usernameDomain = useNetworkStore((s) => s.usernameDomain);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!account && typeof window !== 'undefined') {
      const t = setTimeout(() => {
        if (!useWalletStore.getState().account) router.replace('/');
      }, 100);
      return () => clearTimeout(t);
    }
  }, [account, router]);

  // Identity rule: receive QR encodes the name, never a raw zk1/hex key.
  const displayName = account?.username ? toZkAddress(account.username, usernameDomain) : '';

  const copy = useCallback(() => {
    if (!account || !displayName) return;
    navigator.clipboard.writeText(displayName).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* clipboard not available */
      },
    );
  }, [account, displayName]);

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
            Receive Bitcoin
          </h1>
          <p className="mt-1 text-[13px] text-ink2">
            Share your name. Senders see only what they send to you — nothing else.
          </p>
        </div>

        {/* QR Code — encodes the name only (mandate: names everywhere). */}
        <div className="flex justify-center">
          <div data-testid="qr-code" className="rounded-md border border-line2 bg-white p-4">
            {displayName ? (
              <QRCodeSVG
                value={displayName}
                size={208}
                bgColor="#ffffff"
                fgColor="#000000"
                level="M"
                title="Receive name QR code"
              />
            ) : (
              <p
                className="w-[208px] p-4 text-center text-[12px] text-ink3"
                data-testid="receive-name-required"
              >
                Set a name on the wallet screen before sharing a receive QR.
              </p>
            )}
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink2">Your name</label>
          <div className="rounded-md border border-line2 bg-surface px-4 py-3 mono text-center text-[14px] text-ink">
            {displayName || '—'}
          </div>
          <button
            data-testid="receive-copy-btn"
            data-copied={copied || undefined}
            onClick={copy}
            disabled={!displayName}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-line2 py-3 text-[13px] font-semibold tracking-tight text-ink transition-colors hover:border-bitcoin hover:text-bitcoin disabled:opacity-50"
          >
            {copied ? <Check size={15} strokeWidth={2.5} /> : <Copy size={15} strokeWidth={2} />}
            {copied ? 'Copied' : 'Copy name'}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
