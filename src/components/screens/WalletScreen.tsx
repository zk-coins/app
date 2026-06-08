'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
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
import { api, type HistoryItem, type AssetBalance } from '@/lib/api/client';
import { formatAssetAmount, shortAssetId, toZkAddress } from '@/lib/format';
import { useFeatures } from '@/lib/features';
import { useHistory } from '@/hooks/useHistory';
import { usePortfolio } from '@/hooks/usePortfolio';

export function WalletScreen() {
  const t = useTranslations('wallet');
  const { account, setUsername } = useWalletStore();
  const { items: history, loaded: historyLoaded } = useHistory(account?.address);
  const { assets, loaded: portfolioLoaded } = usePortfolio(account?.address);
  const { usernameDomain, setNetworkName, setBitcoinNetwork, setUsernameDomain } =
    useNetworkStore();
  const features = useFeatures();
  const [copied, setCopied] = useState(false);
  const [claimInput, setClaimInput] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Fetch network info once. The server is the source of truth for the
  // username domain — see `useNetworkStore` for the rationale.
  useEffect(() => {
    api
      .info()
      .then((info) => {
        setNetworkName(info.network);
        setBitcoinNetwork(info.bitcoin_network ?? '');
        setUsernameDomain(info.username_domain ?? '');
      })
      .catch(() => {});
  }, [setNetworkName, setBitcoinNetwork, setUsernameDomain]);

  const zkAddress = account ? toZkAddress(account.address, usernameDomain) : '';

  const claimUsername = useCallback(async () => {
    if (!account || !claimInput || !account.xpriv) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await api.claimUsername({
        username: claimInput,
        address: account.address,
        xpriv: account.xpriv,
      });
      setUsername(res.username);
      setClaimInput('');
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : t('claimFailed'));
    } finally {
      setClaiming(false);
    }
  }, [account, claimInput, setUsername, t]);

  const copyAddress = useCallback(() => {
    if (!account) return;
    navigator.clipboard.writeText(zkAddress).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* clipboard not available */
      },
    );
  }, [account, zkAddress]);

  const portfolioEmpty = portfolioLoaded && assets.length === 0;

  return (
    <section className="space-y-7">
      {/* Header — wordmark left only */}
      <header className="flex items-center gap-2.5">
        <Logo size={26} />
        <span className="text-[15px] font-semibold tracking-tight text-ink">{t('brand')}</span>
      </header>

      {/* Username + address */}
      {account && (
        <div className="space-y-1.5">
          {account.username && usernameDomain && (
            <p className="mono text-[12px] text-ink2">{`${account.username}@${usernameDomain}`}</p>
          )}
          {features.USERNAME_CLAIM && !account.username && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                claimUsername();
              }}
            >
              <input
                type="text"
                value={claimInput}
                onChange={(e) => {
                  setClaimInput(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''));
                  setClaimError(null);
                }}
                placeholder={t('claimUsernamePlaceholder')}
                className="flex-1 rounded-md border border-line2 bg-surface px-2.5 py-1.5 mono text-[11px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
              />
              <button
                type="submit"
                data-testid="username-claim-btn"
                disabled={claiming || !claimInput}
                className="rounded-md bg-bitcoin px-3 py-1.5 text-[11px] font-semibold text-bg transition-colors hover:bg-bitcoin-hover disabled:opacity-50"
              >
                {claiming ? t('claiming') : t('claim')}
              </button>
            </form>
          )}
          {features.USERNAME_CLAIM && claimError && (
            <p className="text-[11px] text-bad">{claimError}</p>
          )}
          <button
            data-testid="address-copy-btn"
            data-copied={copied || undefined}
            onClick={copyAddress}
            className="inline-flex items-center gap-1.5 mono text-[11px] text-ink3 transition-colors hover:text-ink"
            title={account.address}
          >
            {copied ? (
              <Check size={11} strokeWidth={2.5} className="text-bitcoin" />
            ) : (
              <Copy size={11} strokeWidth={2} />
            )}
            <span>{zkAddress}</span>
            {copied && (
              <span data-testid="address-copied-feedback" className="text-bitcoin">
                {t('copied')}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Send + Receive */}
      <div className="grid grid-cols-2 gap-3">
        <PrimaryButton
          href="/send"
          disabled={!account || assets.length === 0}
          icon="send"
          label={t('send')}
        />
        <PrimaryButton href="/receive" disabled={!account} icon="receive" label={t('receive')} />
      </div>

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
        {assets.length > 0 ? (
          <AssetList assets={assets} unknownName={t('txMint')} />
        ) : !account || portfolioEmpty ? (
          <EmptyPortfolio
            hasWallet={!!account}
            title={t('portfolioEmptyTitle')}
            body={t('portfolioEmptyBody')}
          />
        ) : null}
      </div>

      {/* PWA install prompt */}
      <PwaPrompt />

      {/* Transactions */}
      <div>
        {history.length > 0 ? (
          <TransactionsList
            items={history.slice(0, 10)}
            labels={{ sent: t('txSent'), received: t('txReceived'), mint: t('txMint') }}
          />
        ) : !account || historyLoaded ? (
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
                  className="mono text-[11px] text-ink4"
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
}: {
  items: HistoryItem[];
  labels: { sent: string; received: string; mint: string };
}) {
  return (
    <ul className="space-y-2">
      {items.map((tx) => {
        const positive = tx.direction !== 'send';
        const label =
          tx.direction === 'mint'
            ? labels.mint
            : tx.direction === 'send'
              ? labels.sent
              : labels.received;
        const Icon =
          tx.direction === 'send' ? ArrowUpRight : tx.direction === 'mint' ? Plus : ArrowDownLeft;
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
                    {new Date(tx.timestamp * 1000).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
              <span
                data-testid="tx-row-amount"
                className={`mono text-[13px] font-medium tabular-nums ${
                  positive ? 'text-ink' : 'text-bitcoin'
                }`}
              >
                {(positive ? tx.amount : -tx.amount).toLocaleString('en-US')}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
