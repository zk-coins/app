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
  Zap,
  Receipt,
} from 'lucide-react';
import { Logo } from '../icons/Logo';
import { PwaPrompt } from '../PwaPrompt';
import { useWalletStore, type Transaction } from '@/stores/wallet';
import { api } from '@/lib/api/client';
import { formatBtc, formatBtcCompact, formatUsd, truncateAddress } from '@/lib/format';

const HIDDEN = '••••';
const FAUCET_AMOUNT = 10_000;

export function WalletScreen() {
  const { account, transactions, setBalance, addTransaction } = useWalletStore();
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fauceting, setFauceting] = useState(false);
  const [faucetError, setFaucetError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    const tick = async () => {
      try {
        const { balance } = await api.balance(account.address);
        setBalance(balance);
      } catch {
        /* silent */
      }
    };
    tick();
    const interval = setInterval(tick, 5000);
    return () => clearInterval(interval);
  }, [account, setBalance]);

  const copyAddress = useCallback(() => {
    if (!account) return;
    navigator.clipboard.writeText(account.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [account]);

  const faucet = useCallback(async () => {
    if (!account || fauceting) return;
    setFauceting(true);
    setFaucetError(null);
    try {
      const res = await api.mint(account.address);
      const { balance } = await api.balance(account.address);
      setBalance(balance);
      addTransaction({
        id: res.proof_id?.toString() ?? `mint-${Date.now()}`,
        type: 'mint',
        amount: FAUCET_AMOUNT,
        timestamp: Date.now(),
        proofId: res.proof_id?.toString(),
      });
    } catch (err) {
      setFaucetError(
        err instanceof Error ? err.message : 'Faucet unreachable. Try again later.',
      );
    } finally {
      setFauceting(false);
    }
  }, [account, fauceting, setBalance, addTransaction]);

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

        {/* Address — clean copy button */}
        {account && (
          <button
            onClick={copyAddress}
            className="mt-2 inline-flex items-center gap-1.5 mono text-[11px] text-ink3 transition-colors hover:text-ink"
            title={account.address}
          >
            {copied ? <Check size={11} strokeWidth={2.5} className="text-bitcoin" /> : <Copy size={11} strokeWidth={2} />}
            <span>{truncateAddress(account.address, 6, 6)}</span>
            {copied && <span className="text-bitcoin">copied</span>}
          </button>
        )}
      </div>

      {/* Send + Receive */}
      <div className="grid grid-cols-2 gap-3">
        <PrimaryButton href="/send" disabled={!account} icon="send" label="Send" />
        <PrimaryButton href="/receive" disabled={!account} icon="receive" label="Receive" />
      </div>

      {/* No-balance helper */}
      {account && sats <= 0 && (
        <div className="flex items-start gap-3 rounded-md border border-bitcoin/30 bg-bitcoin/5 p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bitcoin/10 text-bitcoin">
            <Zap size={14} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-ink">Wallet is empty</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink2">
              Add sats via the testnet faucet (mock-prover phase) or buy private BTC through{' '}
              <Link href="/apps" className="text-bitcoin hover:underline">
                DFX
              </Link>
              .
            </p>
            {faucetError && <p className="mt-1 text-[10px] text-bad">{faucetError}</p>}
          </div>
          <button
            onClick={faucet}
            disabled={fauceting}
            className="shrink-0 self-center rounded-md border border-bitcoin px-3 py-1.5 text-[11px] font-semibold tracking-wide text-bitcoin transition-colors hover:bg-bitcoin/10 disabled:opacity-50"
          >
            {fauceting ? '…' : '+ Faucet'}
          </button>
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
