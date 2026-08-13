'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowUpRight, ArrowDownLeft, Plus, Receipt, Info } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useHistory } from '@/hooks/useHistory';
import type { HistoryItem } from '@/lib/api/client';
import { formatAssetAmount, shortAssetId } from '@/lib/format';
import { useFeatures } from '@/lib/features';
import { useCapabilities } from '@/stores/capabilities';

export default function AssetDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const t = useTranslations('asset');
  const tWallet = useTranslations('wallet');
  const account = useWalletStore((s) => s.account);
  const infoError = useNetworkStore((s) => s.infoError);
  const isLoading = useWalletStore((s) => s.isLoading);
  const { MULTI_ASSET: multiAssetRuntime, loaded: featuresLoaded } = useFeatures();

  useEffect(() => {
    void useCapabilities.getState().fetch();
  }, []);

  // Runtime gate: a capability-adaptive bundle talking to a single-asset
  // node has no per-asset detail — redirect home. Wait for capabilities so
  // fail-closed defaults do not bounce before /v1/info lands. Do not redirect
  // on infoError: fail-closed multi_asset:false after a failed GET /v1/info is
  // not "feature missing".
  useEffect(() => {
    if (
      featuresLoaded &&
      !multiAssetRuntime &&
      !infoError &&
      /* v8 ignore next -- This useEffect runs only after this client component mounts in a browser realm. */
      typeof window !== 'undefined'
    ) {
      router.replace('/');
    }
  }, [featuresLoaded, multiAssetRuntime, infoError, router]);

  const assetId = params.id;
  const {
    assets,
    loaded,
    available: portfolioAvailable,
    error: portfolioError,
    unavailableReason,
  } = usePortfolio(account?.address);
  const historyAccount =
    account && account.mnemonic && account.nkCommit
      ? {
          address: account.address,
          mnemonic: account.mnemonic,
          nkCommit: account.nkCommit,
        }
      : undefined;
  const { items: history } = useHistory(historyAccount);
  // not-found only after a successful, available portfolio read without this asset
  const asset = portfolioAvailable ? assets.find((a) => a.asset_id === assetId) : undefined;
  const portfolioBlocked = loaded && (!portfolioAvailable || portfolioError !== null);
  const walletUnavailable = account == null && !isLoading;
  const rawDecimals = asset?.decimals;
  const validDecimals =
    typeof rawDecimals === 'number' && Number.isInteger(rawDecimals) && rawDecimals >= 0
      ? rawDecimals
      : null;

  return (
    <AppShell showNav={false}>
      <header className="flex items-center justify-between">
        <Link
          href="/"
          data-testid="asset-detail-back"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink3 transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} strokeWidth={2} />
          {t('back')}
        </Link>
        <span className="text-[11px] font-medium tracking-wider text-ink3 uppercase">
          {t('eyebrow')}
        </span>
      </header>

      {walletUnavailable ? (
        <div
          data-testid="asset-detail-wallet-unavailable"
          className="flex min-h-[60vh] flex-col items-center justify-center text-center"
          role="status"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-ink4">
            <Info size={22} strokeWidth={1.75} />
          </div>
          <p className="mt-4 text-[15px] font-semibold text-ink">{tWallet('txUnlockToView')}</p>
          <Link
            href="/"
            className="mt-6 rounded-md bg-bitcoin px-6 py-2.5 text-[13px] font-semibold text-bg transition-colors hover:bg-bitcoin-hover"
          >
            {t('backToWallet')}
          </Link>
        </div>
      ) : portfolioBlocked ? (
        <div
          data-testid={portfolioError ? 'asset-detail-error' : 'asset-detail-unavailable'}
          className="flex min-h-[60vh] flex-col items-center justify-center text-center"
          role="status"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-ink4">
            <Info size={22} strokeWidth={1.75} />
          </div>
          <p className="mt-4 text-[15px] font-semibold text-ink">
            {portfolioError ? t('errorTitle') : t('unavailableTitle')}
          </p>
          <p className="mt-1 max-w-[280px] text-[13px] leading-relaxed text-ink3">
            {portfolioError ? portfolioError : (unavailableReason ?? t('unavailableBody'))}
          </p>
          <Link
            href="/"
            className="mt-6 rounded-md bg-bitcoin px-6 py-2.5 text-[13px] font-semibold text-bg transition-colors hover:bg-bitcoin-hover"
          >
            {t('backToWallet')}
          </Link>
        </div>
      ) : !asset ? (
        loaded ? (
          <div
            data-testid="asset-detail-missing"
            className="flex min-h-[60vh] flex-col items-center justify-center text-center"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-ink4">
              <Receipt size={22} strokeWidth={1.75} />
            </div>
            <p className="mt-4 text-[15px] font-semibold text-ink">{t('notFoundTitle')}</p>
            <p className="mt-1 max-w-[280px] text-[13px] leading-relaxed text-ink3">
              {t('notFoundBody')}
            </p>
            <Link
              href="/"
              className="mt-6 rounded-md bg-bitcoin px-6 py-2.5 text-[13px] font-semibold text-bg transition-colors hover:bg-bitcoin-hover"
            >
              {t('backToWallet')}
            </Link>
          </div>
        ) : null
      ) : (
        <section data-testid="asset-detail-body" className="mt-8 space-y-8">
          {/* Hero — balance */}
          <div className="flex flex-col items-center text-center">
            <p data-testid="asset-detail-name" className="text-[13px] font-medium text-ink3">
              {asset.name ?? t('unknownName')}
            </p>
            <p
              data-testid="asset-detail-balance"
              className="mt-1 mono text-[34px] font-bold tabular-nums text-ink"
            >
              {validDecimals !== null && Number.isSafeInteger(asset.balance) && asset.balance >= 0
                ? formatAssetAmount(asset.balance, validDecimals)
                : t('unknownAmount')}
            </p>
            <p
              data-testid="asset-detail-id-short"
              className="mt-2 mono text-[11px] text-ink3"
              title={asset.asset_id}
            >
              {shortAssetId(asset.asset_id)}
            </p>
          </div>

          {/* Details */}
          <div>
            <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-ink3 uppercase">
              {t('detailsTitle')}
            </h2>
            <dl className="divide-y divide-line rounded-md border border-line bg-surface px-4">
              <DetailRow label={t('name')} testid="asset-row-name">
                <span className="text-[12px] text-ink">{asset.name ?? t('unknownName')}</span>
              </DetailRow>
              <DetailRow label={t('assetId')} testid="asset-row-id">
                <span className="mono text-[12px] text-ink2" title={asset.asset_id}>
                  {shortAssetId(asset.asset_id)}
                </span>
              </DetailRow>
              <DetailRow label={t('decimals')} testid="asset-row-decimals">
                <span className="mono text-[12px] text-ink">
                  {validDecimals !== null ? validDecimals : t('unknownDecimals')}
                </span>
              </DetailRow>
              <DetailRow label={t('balanceLabel')} testid="asset-row-balance">
                <span className="mono text-[12px] text-ink">
                  {validDecimals !== null &&
                  Number.isSafeInteger(asset.balance) &&
                  asset.balance >= 0
                    ? formatAssetAmount(asset.balance, validDecimals)
                    : t('unknownAmount')}
                </span>
              </DetailRow>
              <DetailRow label={t('sends')} testid="asset-row-sends">
                <span className="mono text-[12px] text-ink">{asset.num_sends}</span>
              </DetailRow>
            </dl>
          </div>

          <Link
            href={`/send?asset=${encodeURIComponent(asset.asset_id)}`}
            data-testid="asset-send-btn"
            className="flex items-center justify-center gap-2 rounded-md bg-bitcoin py-3.5 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover"
          >
            <ArrowUpRight size={16} strokeWidth={2.25} />
            {t('sendAsset')}
          </Link>

          {/* Owner history with the per-wallet note */}
          <div>
            <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-ink3 uppercase">
              {t('historyTitle')}
            </h2>
            <div
              data-testid="asset-history-note"
              className="mb-3 flex items-start gap-2 rounded-md border border-line2 bg-surface p-3 text-[11px] leading-relaxed text-ink3"
            >
              <Info size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
              <span>{t('historyNote')}</span>
            </div>
            <AssetHistory
              items={history.slice(0, 10)}
              labels={{
                sent: tWallet('txSent'),
                received: tWallet('txReceived'),
                mint: tWallet('txMint'),
                unknown: tWallet('txUnknown'),
              }}
            />
          </div>
        </section>
      )}
    </AppShell>
  );
}

function DetailRow({
  label,
  children,
  testid,
}: {
  label: string;
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="shrink-0 text-[12px] text-ink3">{label}</dt>
      <dd className="min-w-0 truncate text-right" data-testid={testid}>
        {children}
      </dd>
    </div>
  );
}

function AssetHistory({
  items,
  labels,
}: {
  items: HistoryItem[];
  labels: { sent: string; received: string; mint: string; unknown: string };
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-2">
      {items.map((tx) => {
        const kind = tx.kind;
        let polarity: 'credit' | 'debit' | 'unknown';
        let label: string;
        let Icon: typeof ArrowUpRight;
        if (kind === 'mint') {
          polarity = 'credit';
          label = labels.mint;
          Icon = Plus;
        } else if (kind === 'send') {
          polarity = 'debit';
          label = labels.sent;
          Icon = ArrowUpRight;
        } else if (kind === 'receive') {
          polarity = 'credit';
          label = labels.received;
          Icon = ArrowDownLeft;
        } else {
          polarity = 'unknown';
          label = labels.unknown;
          Icon = Receipt;
        }
        const isDebit = polarity === 'debit';
        const amountText = typeof tx.amount === 'number' ? tx.amount.toLocaleString('en-US') : '—';
        return (
          <li key={tx.id}>
            <Link
              href={`/tx/${tx.id}`}
              data-testid="asset-tx-row"
              className="flex items-center justify-between rounded-md border border-line bg-surface px-4 py-3 transition-colors hover:border-line2"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-md ${
                    isDebit ? 'bg-bitcoin/10 text-bitcoin' : 'bg-line text-ink2'
                  }`}
                >
                  <Icon size={15} strokeWidth={2.25} />
                </div>
                <p className="text-[13px] font-medium text-ink">{label}</p>
              </div>
              <span className="mono text-[13px] font-medium tabular-nums text-ink2">
                {amountText}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
