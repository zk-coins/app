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

/**
 * Receive surface.
 *
 * Preferred path: name (when provisioned). Name claim / NIP-05 setup is
 * not wired on the closed /v1 surface yet, so without a name we offer the
 * Bech32m subject as a technical receive payload and label it honestly —
 * never pretend a name exists.
 */
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

  const hasName = Boolean(account?.username);
  const displayName = account?.username ? toZkAddress(account.username, usernameDomain) : '';
  // Usable receive payload: name when set, otherwise the account subject.
  const receivePayload = hasName ? displayName : (account?.address ?? '');
  const receiveLabel = hasName ? 'Your name' : 'Your account address';
  const copyLabel = hasName ? 'Copy name' : 'Copy address';

  const copy = useCallback(() => {
    if (!account || !receivePayload) return;
    navigator.clipboard.writeText(receivePayload).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* clipboard not available */
      },
    );
  }, [account, receivePayload]);

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
            {hasName
              ? 'Share your name. Senders see only what they send to you — nothing else.'
              : 'Name setup is not available yet in this build. Share your account address to receive.'}
          </p>
        </div>

        {!hasName && (
          <div
            data-testid="receive-name-unavailable"
            className="rounded-md border border-line2 bg-surface p-3 text-[12px] leading-relaxed text-ink2"
            role="status"
          >
            Name-based receive is not available yet — NIP-05 / name claim is not wired. Sharing the
            Bech32m account address below is a technical fallback, not a finished identity UX.
          </div>
        )}

        <div className="flex justify-center">
          <div data-testid="qr-code" className="rounded-md border border-line2 bg-white p-4">
            {receivePayload ? (
              <QRCodeSVG
                value={receivePayload}
                size={208}
                bgColor="#ffffff"
                fgColor="#000000"
                level="M"
                title={hasName ? 'Receive name QR code' : 'Receive address QR code'}
              />
            ) : (
              <p
                className="w-[208px] p-4 text-center text-[12px] text-ink3"
                data-testid="receive-not-available"
              >
                Receive is not available yet.
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink2">{receiveLabel}</label>
          <div className="rounded-md border border-line2 bg-surface px-4 py-3 mono text-center text-[14px] text-ink break-all">
            {receivePayload || '—'}
          </div>
          <button
            data-testid="receive-copy-btn"
            data-copied={copied || undefined}
            onClick={copy}
            disabled={!receivePayload}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-line2 py-3 text-[13px] font-semibold tracking-tight text-ink transition-colors hover:border-bitcoin hover:text-bitcoin disabled:opacity-50"
          >
            {copied ? <Check size={15} strokeWidth={2.5} /> : <Copy size={15} strokeWidth={2} />}
            {copied ? 'Copied' : copyLabel}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
