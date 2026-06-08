'use client';

import { Suspense, useState, useCallback, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Check, QrCode, Wallet } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { usePortfolio } from '@/hooks/usePortfolio';
import { ApiError, JobFailedError, api, type JobStatus } from '@/lib/api/client';
import { userMessageFor } from '@/lib/api/errorMessages';
import { formatAssetAmount, shortAssetId } from '@/lib/format';

const QrScanModal = dynamic(() => import('@/components/QrScanModal').then((m) => m.QrScanModal), {
  ssr: false,
});

/**
 * `useSearchParams()` (read for the `?asset=` deep-link from the asset
 * detail page) opts the route into client-side rendering, so Next requires
 * a Suspense boundary around the component for the static prerender to
 * succeed. The default export provides it; the real page is `SendPageInner`.
 */
export default function SendPage() {
  return (
    <Suspense fallback={null}>
      <SendPageInner />
    </Suspense>
  );
}

function SendPageInner() {
  const router = useRouter();
  const t = useTranslations('send');
  const tErrors = useTranslations('errors');
  const searchParams = useSearchParams();
  const account = useWalletStore((s) => s.account);
  const usernameDomain = useNetworkStore((s) => s.usernameDomain);
  const { assets } = usePortfolio(account?.address);

  // Redirect to home (which handles unlock) if no account in memory.
  useEffect(() => {
    if (!account && typeof window !== 'undefined') {
      const id = setTimeout(() => {
        if (!useWalletStore.getState().account) router.replace('/');
      }, 100);
      return () => clearTimeout(id);
    }
  }, [account, router]);

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ amount: number; proofId?: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);

  // Default the picker: the `?asset=` query param (from the asset detail
  // "send" button) if it points at a held asset, else the first asset.
  useEffect(() => {
    if (assets.length === 0) return;
    setSelectedAssetId((current) => {
      if (current && assets.some((a) => a.asset_id === current)) return current;
      const fromQuery = searchParams.get('asset');
      if (fromQuery && assets.some((a) => a.asset_id === fromQuery)) return fromQuery;
      return assets[0].asset_id;
    });
  }, [assets, searchParams]);

  const selectedAsset = useMemo(
    () => assets.find((a) => a.asset_id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );
  const decimals = selectedAsset?.decimals ?? 0;
  const assetBalance = selectedAsset?.balance ?? null;
  const assetName =
    selectedAsset?.name ?? (selectedAsset ? shortAssetId(selectedAsset.asset_id) : '');

  // Parse the typed amount (human units) into raw atomic units.
  const parseAmount = useCallback(
    (raw: string): number | null => {
      const num = parseFloat(raw);
      if (!Number.isFinite(num) || num <= 0) return null;
      return Math.round(num * 10 ** decimals);
    },
    [decimals],
  );

  useEffect(() => {
    if (!scanned) return;
    const id = setTimeout(() => setScanned(false), 1500);
    return () => clearTimeout(id);
  }, [scanned]);

  const handleScanResult = useCallback((address: string) => {
    setRecipient(address);
    setScanning(false);
    setScanned(true);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!account || !recipient || !amount || !selectedAsset) return;
    const raw = parseAmount(amount);
    if (raw === null) {
      setError(t('errInvalidAmount'));
      return;
    }
    if (assetBalance === null) {
      setError(t('errBalanceNotLoaded'));
      return;
    }
    if (raw > assetBalance) {
      setError(t('errInsufficient'));
      return;
    }
    setError(null);
    setConfirming(true);
  }, [account, recipient, amount, selectedAsset, parseAmount, assetBalance, t]);

  const send = useCallback(async () => {
    if (!account || !selectedAsset) return;
    setConfirming(false);
    const raw = parseAmount(amount);
    if (raw === null) return;

    setSending(true);
    setPhase(null);
    setError(null);
    try {
      if (!account.xpriv) throw new Error(t('errNoPrivateKey'));

      let resolvedRecipient = recipient.trim();
      if (resolvedRecipient.startsWith('$')) {
        resolvedRecipient = resolvedRecipient.slice(1);
      }
      if (usernameDomain) {
        const suffix = `@${usernameDomain}`;
        if (resolvedRecipient.endsWith(suffix)) {
          resolvedRecipient = resolvedRecipient.slice(0, -suffix.length);
        }
      }
      if (!resolvedRecipient.startsWith('0x') && !/^[0-9a-f]{64}$/i.test(resolvedRecipient)) {
        const resolved = await api.resolveUsername(resolvedRecipient);
        resolvedRecipient = resolved.address;
      }

      const result = await api.send(
        {
          account_address: account.address,
          recipient: resolvedRecipient,
          amount: raw,
          asset_id: selectedAsset.asset_id,
          xpriv: account.xpriv,
        },
        { onPhase: (job: JobStatus) => setPhase(job.phase) },
      );

      const proofId = result.result?.proof_id ?? undefined;
      setSuccess({ amount: raw, proofId: proofId?.toString() });
    } catch (err) {
      if (err instanceof ApiError || err instanceof JobFailedError) {
        setError(userMessageFor(err, tErrors));
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t('errGeneric'));
      }
    } finally {
      setSending(false);
      setPhase(null);
    }
  }, [account, recipient, amount, selectedAsset, parseAmount, usernameDomain, t, tErrors]);

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

  if (success) {
    return (
      <AppShell showNav={false}>
        <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-bitcoin text-bg">
            <Check size={28} strokeWidth={2.5} />
          </div>
          <h1
            data-testid="send-success-heading"
            className="mt-6 text-[22px] font-bold tracking-tight text-ink"
          >
            {t('successHeading')}
          </h1>
          <p
            data-testid="send-success-amount"
            className="mt-2 mono text-[14px] text-ink2 tabular-nums"
          >
            {formatAssetAmount(success.amount, decimals)} {assetName}
          </p>
          {success.proofId && (
            <p data-testid="proof-id" className="mt-4 mono text-[11px] text-ink4">
              {t('proof', { id: success.proofId })}
            </p>
          )}
          <button
            aria-label={t('done')}
            onClick={() => router.push('/')}
            className="mt-10 rounded-md bg-bitcoin px-8 py-3 text-[13px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover"
          >
            {t('done')}
          </button>
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

      <form
        className="mt-10 space-y-7"
        onSubmit={(e) => {
          e.preventDefault();
          handleConfirm();
        }}
      >
        <div>
          <h1 data-testid="send-heading" className="text-[26px] font-bold tracking-tight text-ink">
            {t('heading')}
          </h1>
          <p className="mt-1 text-[13px] text-ink2">{t('subtitle')}</p>
        </div>

        {/* Asset picker */}
        <div>
          <label htmlFor="send-asset" className="mb-1.5 block text-[12px] font-medium text-ink2">
            {t('assetLabel')}
          </label>
          {assets.length === 0 ? (
            <p data-testid="send-asset-empty" className="text-[12px] text-ink3">
              {t('assetEmpty')}
            </p>
          ) : (
            <select
              id="send-asset"
              data-testid="send-asset-select"
              value={selectedAssetId ?? ''}
              onChange={(e) => {
                setSelectedAssetId(e.target.value);
                setAmount('');
                setError(null);
              }}
              className="w-full rounded-md border border-line2 bg-surface px-4 py-3 text-[14px] text-ink outline-none transition-colors focus:border-bitcoin"
            >
              {assets.map((asset) => (
                <option key={asset.asset_id} value={asset.asset_id}>
                  {(asset.name ?? shortAssetId(asset.asset_id)) +
                    ' · ' +
                    formatAssetAmount(asset.balance, asset.decimals)}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Available */}
        <div className="rounded-md border border-line bg-surface p-3 text-[12px]">
          <span className="text-ink3">{t('available')}</span>
          <span
            data-testid="send-available"
            data-loading={assetBalance === null || undefined}
            className="mono text-ink tabular-nums"
          >
            {assetBalance === null
              ? `— ${assetName}`
              : `${formatAssetAmount(assetBalance, decimals)} ${assetName}`}
          </span>
        </div>

        {/* No-balance banner */}
        {assetBalance === 0 && (
          <div
            data-testid="send-no-funds-banner"
            className="rounded-md border border-bitcoin/30 bg-bitcoin/5 p-3 text-[12px] leading-relaxed text-ink2"
          >
            <span className="font-semibold text-bitcoin">{t('noFundsTitle')}</span>
          </div>
        )}

        {/* Recipient */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[12px] font-medium text-ink2">{t('recipient')}</label>
            <button
              type="button"
              data-testid="send-scan-qr-btn"
              onClick={() => setScanning(true)}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-bitcoin transition-colors hover:text-bitcoin-hover"
            >
              <QrCode size={14} strokeWidth={2} />
              {t('scanQr')}
            </button>
          </div>
          <input
            data-testid="send-recipient-input"
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder={usernameDomain ? `alice@${usernameDomain}` : ''}
            className="w-full rounded-md border border-line2 bg-surface px-4 py-3 mono text-[14px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
          />
          {scanned && (
            <p
              data-testid="send-scan-feedback"
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-bitcoin"
            >
              <Check size={13} strokeWidth={2.5} />
              {t('addressScanned')}
            </p>
          )}
        </div>

        {/* Amount */}
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink2">{t('amount')}</label>
          <div className="relative">
            <input
              data-testid="send-amount-input"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="0"
              className="w-full rounded-md border border-line2 bg-surface px-4 py-3 pr-20 mono text-[14px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] font-medium text-ink3">
              {assetName}
            </span>
          </div>
          <button
            type="button"
            data-testid="send-setmax-btn"
            onClick={() => {
              if (assetBalance !== null && assetBalance > 0)
                setAmount(formatAssetAmount(assetBalance, decimals).replace(/,/g, ''));
            }}
            disabled={assetBalance === null || assetBalance === 0}
            className="mt-2 text-[12px] font-medium text-bitcoin transition-colors hover:text-bitcoin-hover disabled:cursor-not-allowed disabled:text-ink4"
          >
            {t('setMax')}
          </button>
        </div>

        {error && (
          <p data-testid="send-error" className="text-[12px] text-bad">
            <span className="text-ink3">{t('errPrefix')}</span> {error}
          </p>
        )}

        {confirming ? (
          <div
            data-testid="send-confirm-card"
            className="space-y-4 rounded-md border border-bitcoin/30 bg-bitcoin/5 p-4"
          >
            <p className="text-[13px] text-ink">
              {t('confirmTo', {
                amount: formatAssetAmount(parseAmount(amount) ?? 0, decimals),
                asset: assetName,
              })}
            </p>
            <p className="mono break-all text-[12px] text-ink2">{recipient}</p>
            <p className="text-[11px] text-ink3">{t('cannotUndo')}</p>
            <div className="flex gap-3">
              <button
                type="button"
                data-testid="send-cancel-btn"
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-md border border-line2 py-3 text-[13px] text-ink2 transition-colors hover:border-ink2 hover:text-ink"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                data-testid="send-confirm-btn"
                onClick={send}
                disabled={sending}
                className="flex-1 rounded-md bg-bitcoin py-3 text-[13px] font-semibold text-bg transition-colors hover:bg-bitcoin-hover disabled:bg-line disabled:text-ink4"
              >
                {sending ? t('creatingProof') : t('confirmSend')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="submit"
            data-testid="send-submit-btn"
            disabled={sending || !recipient || !amount || assets.length === 0}
            className="w-full rounded-md bg-bitcoin py-4 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
          >
            {t('sendPrivately')}
          </button>
        )}

        {sending && phase && (
          <p data-testid="send-phase" className="text-center text-[11px] text-ink3">
            {phase}
          </p>
        )}
      </form>

      {scanning && <QrScanModal onResult={handleScanResult} onClose={() => setScanning(false)} />}
    </AppShell>
  );
}
