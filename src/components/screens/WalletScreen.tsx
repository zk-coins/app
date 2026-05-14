'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
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
import { useWalletStore, type Transaction } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { api } from '@/lib/api/client';
import { formatBtc, formatBtcCompact, formatUsd, toZkAddress } from '@/lib/format';
import { FEATURES } from '@/lib/features';

const HIDDEN = '••••';

export function WalletScreen() {
  const { account, transactions, setBalance, setUsername } = useWalletStore();
  const { networkName, setNetworkName } = useNetworkStore();
  // Faucet is gated at build time by `NEXT_PUBLIC_ENABLE_FAUCET`. When that
  // flag is off, the entire button — including the mint API call — is dead
  // code and is removed from the production bundle. The additional runtime
  // mainnet check is defence in depth: even on a DEV build, never show the
  // faucet if the connected server happens to report `mainnet`.
  const showFaucet = FEATURES.FAUCET && networkName !== '' && networkName !== 'mainnet';
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  const [minting, setMinting] = useState(false);
  const [claimInput, setClaimInput] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Fetch network info once.
  useEffect(() => {
    api
      .info()
      .then((info) => setNetworkName(info.network))
      .catch(() => {});
  }, [setNetworkName]);

  // Balance polling. Username is only read when the feature is enabled —
  // when off, the server is not expected to return a username and the
  // `setUsername` call would be a no-op anyway.
  useEffect(() => {
    if (!account) return;
    const tick = async () => {
      try {
        const res = await api.balance(account.address);
        setBalance(res.balance);
        if (FEATURES.USERNAMES && res.username && !account.username) {
          setUsername(res.username);
        }
      } catch {
        /* silent */
      }
    };
    tick();
    const interval = setInterval(tick, 5000);
    return () => clearInterval(interval);
  }, [account, setBalance, setUsername]);

  const zkAddress = account ? toZkAddress(account.address) : '';

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

  const sats = account?.balance ?? 0;
  const btc = formatBtc(sats);
  const usd = formatUsd(sats);

  return (
    <section className="space-y-7">
      {/* Header — wordmark left only */}
      <header className="flex items-center gap-2.5">
        <Logo size={26} />
        <span className="text-[15px] font-semibold tracking-tight text-ink">zkCoins</span>
      </header>

      {/* Balance */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-[56px] font-bold leading-none -tracking-[0.02em] text-ink tabular-nums">
            {hidden ? HIDDEN : `$${usd}`}
          </h1>
          <button
            onClick={() => setHidden((h) => !h)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line2 text-ink3 transition-colors hover:border-ink2 hover:text-ink"
            aria-label={hidden ? 'Show balance' : 'Hide balance'}
          >
            {hidden ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
          </button>
        </div>
        <p className="mt-2 mono text-[14px] text-ink2 tabular-nums">
          {hidden ? HIDDEN : `${btc} BTC`}
        </p>

        {/* Username + address */}
        {account && (
          <div className="mt-2 space-y-1.5">
            <p className="mono text-[12px] text-ink2">
              {FEATURES.USERNAMES && account.username
                ? `${account.username}@zkcoins.app`
                : zkAddress}
            </p>
            {FEATURES.USERNAMES && !account.username && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={claimInput}
                  onChange={(e) => {
                    setClaimInput(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''));
                    setClaimError(null);
                  }}
                  placeholder="Claim a username"
                  className="flex-1 rounded-md border border-line2 bg-surface px-2.5 py-1.5 mono text-[11px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
                />
                <button
                  onClick={async () => {
                    if (!claimInput || !account.xpriv) return;
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
                      setClaimError(err instanceof Error ? err.message : 'Claim failed');
                    } finally {
                      setClaiming(false);
                    }
                  }}
                  disabled={claiming || !claimInput}
                  className="rounded-md bg-bitcoin px-3 py-1.5 text-[11px] font-semibold text-bg transition-colors hover:bg-bitcoin-hover disabled:opacity-50"
                >
                  {claiming ? '…' : 'Claim'}
                </button>
              </div>
            )}
            {FEATURES.USERNAMES && claimError && (
              <p className="text-[11px] text-bad">{claimError}</p>
            )}
            <button
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
              {copied && <span className="text-bitcoin">copied</span>}
            </button>
          </div>
        )}
      </div>

      {/* Send + Receive */}
      <div className="grid grid-cols-2 gap-3">
        <PrimaryButton href="/send" disabled={!account} icon="send" label="Send" />
        <PrimaryButton href="/receive" disabled={!account} icon="receive" label="Receive" />
      </div>

      {/* No-balance helper + faucet (faucet button only on testnet) */}
      {account && sats <= 0 && (
        <div className="flex items-start gap-3 rounded-md border border-bitcoin/30 bg-bitcoin/5 p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bitcoin/10 text-bitcoin">
            <CircleDollarSign size={14} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-ink">Wallet is empty</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink2">
              {showFaucet ? (
                <>
                  Claim test sats from the faucet, or share your address via{' '}
                  <Link href="/receive" className="text-bitcoin hover:underline">
                    Receive
                  </Link>
                  .
                </>
              ) : FEATURES.APPS_DIRECTORY ? (
                <>
                  Buy private BTC through{' '}
                  <Link href="/apps" className="text-bitcoin hover:underline">
                    DFX
                  </Link>
                  , or share your address via{' '}
                  <Link href="/receive" className="text-bitcoin hover:underline">
                    Receive
                  </Link>
                  .
                </>
              ) : (
                <>
                  Share your address via{' '}
                  <Link href="/receive" className="text-bitcoin hover:underline">
                    Receive
                  </Link>
                  .
                </>
              )}
            </p>
            {showFaucet && (
              <button
                onClick={async () => {
                  if (!account || minting) return;
                  setMinting(true);
                  try {
                    await api.mint(account.address);
                    const { balance } = await api.balance(account.address);
                    setBalance(balance);
                  } catch {
                    /* faucet may not be available */
                  } finally {
                    setMinting(false);
                  }
                }}
                disabled={minting}
                className="mt-2 rounded-md border border-bitcoin/40 px-3 py-1.5 text-[11px] font-semibold text-bitcoin transition-colors hover:bg-bitcoin/10 disabled:opacity-50"
              >
                {minting ? 'Minting…' : 'Faucet'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* PWA install prompt */}
      <PwaPrompt />

      {/* Transactions */}
      <div>
        {transactions.length === 0 ? (
          <EmptyTransactions hasWallet={!!account} />
        ) : (
          <TransactionsList transactions={transactions.slice(0, 10)} />
        )}
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

function EmptyTransactions({ hasWallet }: { hasWallet: boolean }) {
  return (
    <div className="flex flex-col items-center pt-8 pb-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-ink4">
        <Receipt size={22} strokeWidth={1.75} />
      </div>
      <p className="mt-4 text-[15px] font-semibold text-ink">No transactions yet</p>
      <p className="mt-1 max-w-[260px] text-[13px] leading-relaxed text-ink3">
        {hasWallet
          ? 'Once you send or receive sats privately, they will show up here.'
          : 'Create a wallet to get started.'}
      </p>
    </div>
  );
}

function TransactionsList({ transactions }: { transactions: Transaction[] }) {
  return (
    <ul className="space-y-2">
      {transactions.map((tx) => {
        const positive = tx.type !== 'send';
        const label = tx.type === 'mint' ? 'Faucet' : tx.type === 'send' ? 'Sent' : 'Received';
        const Icon = tx.type === 'send' ? ArrowUpRight : tx.type === 'mint' ? Plus : ArrowDownLeft;
        return (
          <li
            key={tx.id}
            className="flex items-center justify-between rounded-md border border-line bg-surface px-4 py-3"
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
                <p className="mono text-[11px] text-ink3 tabular-nums">
                  {new Date(tx.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
            <span
              className={`mono text-[13px] font-medium tabular-nums ${
                positive ? 'text-ink' : 'text-bitcoin'
              }`}
            >
              {formatBtcCompact(positive ? tx.amount : -tx.amount)} BTC
            </span>
          </li>
        );
      })}
    </ul>
  );
}
