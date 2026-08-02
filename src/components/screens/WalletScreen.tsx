'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Eye,
  EyeOff,
  Copy,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  Receipt,
  CircleDollarSign,
} from 'lucide-react';
import { Logo } from '../icons/Logo';
import { PwaPrompt } from '../PwaPrompt';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { api, historyItemDate, type HistoryItem, type AssetBalance } from '@/lib/api/client';
import { formatAssetAmount, formatBtc, shortAssetId, toZkAddress } from '@/lib/format';
import { useFeatures } from '@/lib/features';
import { useHistory } from '@/hooks/useHistory';
import { usePortfolio } from '@/hooks/usePortfolio';

const HIDDEN = '••••';

export function WalletScreen() {
  const t = useTranslations('wallet');
  const { account } = useWalletStore();
  const historyAccount =
    account && account.mnemonic && account.nkCommit
      ? {
          address: account.address,
          mnemonic: account.mnemonic,
          nkCommit: account.nkCommit,
        }
      : undefined;
  const {
    items: history,
    loaded: historyLoaded,
    available: historyAvailable,
    error: historyError,
    stale: historyStale,
  } = useHistory(historyAccount);
  const features = useFeatures();
  // Runtime multi-asset capability. Portfolio / send still show "not
  // available yet" until AccountState balances + coin inventory decode.
  const multiAsset = features.MULTI_ASSET;
  const {
    assets,
    loaded: portfolioLoaded,
    available: portfolioAvailable,
    error: portfolioError,
    unavailableReason: portfolioUnavailableReason,
    stale: portfolioStale,
  } = usePortfolio(multiAsset ? account?.address : undefined);
  const { usernameDomain, infoError, infoLoaded, applyInfo, applyInfoFailure } = useNetworkStore();
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch network info once. Failure is a visible error — never a silent
  // fallback to a guessed network (v1 migration / no-fallback contract).
  useEffect(() => {
    api
      .info()
      .then((info) => {
        applyInfo({
          network: info.network,
          features: info.features,
          username_domain: info.username_domain,
        });
      })
      .catch((err: unknown) => {
        applyInfoFailure(err instanceof Error ? err.message : 'failed to load /v1/info');
      });
  }, [applyInfo, applyInfoFailure]);

  // Receive identity is the name when set — never a raw address as identity.
  const displayName = account
    ? account.username
      ? toZkAddress(account.username, usernameDomain)
      : ''
    : '';

  const copyAddress = useCallback(() => {
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

  const claimRow = account && (
    <>
      {infoLoaded && infoError && (
        <p data-testid="network-info-error" className="text-[12px] text-bad" role="alert">
          Could not load node info: {infoError}
        </p>
      )}
      {displayName && (
        <p className="mono text-[12px] text-ink2" data-testid="account-display-name">
          {displayName}
        </p>
      )}
      {/* Name claim is not wired on the closed /v1 surface (NIP-05 setup
          missing SDK-side). Hide the form rather than offering a 501 path. */}
      {!account.username && (
        <p data-testid="name-claim-unavailable" className="text-[11px] text-ink3">
          {t('nameClaimUnavailable')}
        </p>
      )}
      {displayName && (
        <button
          data-testid="address-copy-btn"
          data-copied={copied || undefined}
          onClick={copyAddress}
          className="inline-flex items-center gap-1.5 mono text-[11px] text-ink3 transition-colors hover:text-ink"
          title={displayName}
        >
          {copied ? (
            <Check size={11} strokeWidth={2.5} className="text-bitcoin" />
          ) : (
            <Copy size={11} strokeWidth={2} />
          )}
          <span>{displayName}</span>
          {copied && (
            <span data-testid="address-copied-feedback" className="text-bitcoin">
              {t('copied')}
            </span>
          )}
        </button>
      )}
    </>
  );

  // Empty portfolio only after a successful read with zero assets — never
  // after a load failure or intentional unavailability.
  const portfolioEmpty =
    portfolioLoaded && portfolioAvailable && !portfolioError && assets.length === 0;
  const portfolioBlocked = portfolioLoaded && (!portfolioAvailable || portfolioError !== null);
  // Send needs coin inventory selection from AccountState — not wired yet.
  // Fail closed on BOTH surfaces (never enable a button that leads to an
  // empty-input_coins /v1/tx). The /send route itself also refuses.
  const sendAvailable = false;
  const sendDisabled = !account || !sendAvailable;
  const historyEmpty = historyLoaded && historyAvailable && !historyError && history.length === 0;
  const historyBlocked = historyLoaded && (!historyAvailable || historyError !== null);

  return (
    <section className="space-y-7">
      {/* Header — wordmark left only */}
      <header className="flex items-center gap-2.5">
        <Logo size={26} />
        <span className="text-[15px] font-semibold tracking-tight text-ink">{t('brand')}</span>
      </header>

      {multiAsset ? (
        // ── Multi-asset surface: address chip only (balance lives in the
        //    per-asset portfolio list below) ──
        account && <div className="space-y-1.5">{claimRow}</div>
      ) : (
        // ── Single-asset surface: honest "not available" (never fake 0) ──
        <div data-testid="balance-value">
          <div className="flex items-center gap-3">
            <h1
              data-testid="balance-amount-usd"
              data-loading={undefined}
              data-unavailable="true"
              className="text-[28px] font-bold leading-none -tracking-[0.02em] text-ink"
            >
              {hidden ? HIDDEN : t('balanceUnavailableTitle')}
            </h1>
            <button
              data-testid="balance-toggle-btn"
              data-hidden={hidden || undefined}
              onClick={() => setHidden((h) => !h)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line2 text-ink3 transition-colors hover:border-ink2 hover:text-ink"
              aria-label={hidden ? t('showBalance') : t('hideBalance')}
            >
              {hidden ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
            </button>
          </div>
          <p
            data-testid="balance-amount-btc"
            data-unavailable="true"
            className="mt-2 text-[13px] text-ink2"
          >
            {hidden ? HIDDEN : t('balanceUnavailableBody')}
          </p>

          {account && <div className="mt-2 space-y-1.5">{claimRow}</div>}
        </div>
      )}

      {/* Send + Receive */}
      <div className="grid grid-cols-2 gap-3">
        <PrimaryButton href="/send" disabled={sendDisabled} icon="send" label={t('send')} />
        <PrimaryButton href="/receive" disabled={!account} icon="receive" label={t('receive')} />
      </div>

      {multiAsset ? (
        <>
          {/* Create coin entry (replaces the testnet faucet) */}
          <Link
            href="/create"
            data-testid="create-coin-btn"
            aria-disabled={!account}
            tabIndex={account ? 0 : -1}
            onClick={(e) => !account && e.preventDefault()}
            className={`flex items-center justify-center gap-2 rounded-md border py-3 text-[13px] font-semibold tracking-tight transition-colors ${
              account
                ? 'border-bitcoin/40 text-bitcoin hover:bg-bitcoin/10'
                : 'cursor-not-allowed border-line2 text-ink3'
            }`}
          >
            <CircleDollarSign size={15} strokeWidth={2} />
            {t('createCoin')}
          </Link>

          {/* Portfolio */}
          <div>
            <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-ink3 uppercase">
              {t('portfolioTitle')}
            </h2>
            {portfolioBlocked ? (
              portfolioError ? (
                <UnavailableBanner
                  testId="portfolio-error-banner"
                  title={t('portfolioErrorTitle')}
                  body={portfolioStale ? t('portfolioStaleBody') : portfolioError}
                />
              ) : (
                <UnavailableBanner
                  testId="portfolio-unavailable-banner"
                  title={t('portfolioUnavailableTitle')}
                  body={portfolioUnavailableReason ?? t('portfolioUnavailableBody')}
                />
              )
            ) : assets.length > 0 ? (
              <>
                {portfolioStale && (
                  <p
                    data-testid="portfolio-stale-note"
                    className="mb-2 text-[11px] text-ink3"
                    role="status"
                  >
                    {t('portfolioStaleBody')}
                  </p>
                )}
                <AssetList assets={assets} unknownName={t('txMint')} />
              </>
            ) : !account || portfolioEmpty ? (
              <EmptyPortfolio
                hasWallet={!!account}
                title={t('portfolioEmptyTitle')}
                body={t('portfolioEmptyBody')}
              />
            ) : null}
          </div>
        </>
      ) : (
        // Single-asset: never show "wallet is empty" when balance is unavailable.
        account && (
          <UnavailableBanner
            testId="balance-unavailable-banner"
            title={t('balanceUnavailableTitle')}
            body={t('balanceUnavailableBody')}
          />
        )
      )}

      {/* PWA install prompt */}
      <PwaPrompt />

      {/* Transactions — empty copy only after a successful empty read */}
      <div>
        {history.length > 0 ? (
          <>
            {historyStale && (
              <p
                data-testid="history-stale-note"
                className="mb-2 text-[11px] text-ink3"
                role="status"
              >
                {t('historyStaleBody')}
              </p>
            )}
            <TransactionsList
              items={history.slice(0, 10)}
              multiAsset={multiAsset}
              labels={{ sent: t('txSent'), received: t('txReceived'), mint: t('txMint') }}
            />
          </>
        ) : historyBlocked ? (
          <UnavailableBanner
            testId="history-error-banner"
            title={t('historyErrorTitle')}
            body={historyError ?? t('historyErrorBody')}
          />
        ) : !account || historyEmpty ? (
          <EmptyTransactions
            hasWallet={!!account}
            title={t('noTransactionsTitle')}
            hasWalletBody={t('noTransactionsHasWallet')}
            noWalletBody={t('noTransactionsNoWallet')}
          />
        ) : null}
      </div>
    </section>
  );
}

function UnavailableBanner({
  testId,
  title,
  body,
}: {
  testId: string;
  title: string;
  body: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex items-start gap-3 rounded-md border border-line2 bg-surface p-3"
      role="status"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-line text-ink3">
        <CircleDollarSign size={14} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink2">{body}</p>
      </div>
    </div>
  );
}

function PrimaryButton({
  href,
  disabled,
  icon,
  label,
}: {
  href: string;
  disabled: boolean;
  icon: 'send' | 'receive';
  label: string;
}) {
  const Icon = icon === 'send' ? ArrowUpRight : ArrowDownLeft;
  return (
    <Link
      data-testid={`wallet-${icon}-btn`}
      href={href}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={(e) => disabled && e.preventDefault()}
      className={`flex items-center justify-center gap-2 rounded-md py-3.5 text-[14px] font-semibold tracking-tight transition-colors ${
        disabled
          ? 'cursor-not-allowed border border-line2 text-ink3'
          : 'bg-bitcoin text-bg hover:bg-bitcoin-hover'
      }`}
    >
      <Icon size={16} strokeWidth={2.25} />
      {label}
    </Link>
  );
}

function AssetList({ assets, unknownName }: { assets: AssetBalance[]; unknownName: string }) {
  return (
    <ul data-testid="asset-list" className="space-y-2">
      {assets.map((asset) => (
        <li key={asset.asset_id}>
          <Link
            href={`/asset/${asset.asset_id}`}
            data-testid="asset-row"
            className="flex items-center justify-between rounded-md border border-line bg-surface px-4 py-3 transition-colors hover:border-line2"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-bitcoin/10 text-bitcoin">
                <CircleDollarSign size={15} strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <p
                  data-testid="asset-row-name"
                  className="truncate text-[13px] font-medium text-ink"
                >
                  {asset.name ?? unknownName}
                </p>
                <p
                  data-testid="asset-row-id"
                  className="mono text-[11px] text-ink3"
                  title={asset.asset_id}
                >
                  {shortAssetId(asset.asset_id)}
                </p>
              </div>
            </div>
            <span
              data-testid="asset-row-balance"
              className="mono text-[13px] font-medium tabular-nums text-ink"
            >
              {formatAssetAmount(asset.balance, asset.decimals)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EmptyPortfolio({
  hasWallet,
  title,
  body,
}: {
  hasWallet: boolean;
  title: string;
  body: string;
}) {
  return (
    <div
      data-testid="wallet-empty-banner"
      className="flex items-start gap-3 rounded-md border border-bitcoin/30 bg-bitcoin/5 p-3"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bitcoin/10 text-bitcoin">
        <CircleDollarSign size={14} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-ink">{title}</p>
        {hasWallet && <p className="mt-0.5 text-[11px] leading-relaxed text-ink2">{body}</p>}
      </div>
    </div>
  );
}

function EmptyTransactions({
  hasWallet,
  title,
  hasWalletBody,
  noWalletBody,
}: {
  hasWallet: boolean;
  title: string;
  hasWalletBody: string;
  noWalletBody: string;
}) {
  return (
    <div className="flex flex-col items-center pt-8 pb-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-ink4">
        <Receipt size={22} strokeWidth={1.75} />
      </div>
      <p className="mt-4 text-[15px] font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-[260px] text-[13px] leading-relaxed text-ink3">
        {hasWallet ? hasWalletBody : noWalletBody}
      </p>
    </div>
  );
}

function TransactionsList({
  items,
  labels,
  multiAsset,
}: {
  items: HistoryItem[];
  labels: { sent: string; received: string; mint: string };
  multiAsset: boolean;
}) {
  return (
    <ul className="space-y-2">
      {items.map((tx) => {
        const kind = tx.kind;
        const positive = kind !== 'send';
        const label =
          kind === 'mint' ? labels.mint : kind === 'send' ? labels.sent : labels.received;
        const Icon = kind === 'send' ? ArrowUpRight : kind === 'mint' ? Plus : ArrowDownLeft;
        // Single-asset history renders BTC-denominated amounts; multi-asset
        // history renders raw atomic counts (per-asset decimals differ, so a
        // single unit suffix would be wrong). Amount is optional on thin
        // pull-session locators.
        const amount = typeof tx.amount === 'number' ? tx.amount : undefined;
        const signed = amount === undefined ? undefined : positive ? amount : -amount;
        const amountText =
          signed === undefined
            ? '—'
            : multiAsset
              ? signed.toLocaleString('en-US')
              : `${formatBtc(signed)} BTC`;
        const when = historyItemDate(tx);
        const timeText = Number.isNaN(when.getTime())
          ? '—'
          : when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return (
          <li key={tx.id}>
            <Link
              href={`/tx/${tx.id}`}
              data-testid="tx-row"
              className="flex items-center justify-between rounded-md border border-line bg-surface px-4 py-3 transition-colors hover:border-line2"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-md ${
                    positive ? 'bg-line text-ink2' : 'bg-bitcoin/10 text-bitcoin'
                  }`}
                >
                  <Icon size={15} strokeWidth={2.25} />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-ink">{label}</p>
                  <p data-testid="tx-row-time" className="mono text-[11px] text-ink3 tabular-nums">
                    {timeText}
                  </p>
                </div>
              </div>
              <span
                data-testid="tx-row-amount"
                className={`mono text-[13px] font-medium tabular-nums ${
                  positive ? 'text-ink' : 'text-bitcoin'
                }`}
              >
                {amountText}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
