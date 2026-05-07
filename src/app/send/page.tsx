'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Wallet } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';
import { api } from '@/lib/api/client';
import { initWasm } from '@zkcoins/wasm';
import { SATS_PER_BTC, formatBtc, formatBtcCompact } from '@/lib/format';

export default function SendPage() {
  const router = useRouter();
  const { account, setBalance, incrementPubkeys, addTransaction, loadFromStorage } = useWalletStore();

  // Hydrate from storage on direct navigation, then redirect to onboarding if still empty.
  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);
  useEffect(() => {
    if (!account && typeof window !== 'undefined') {
      // Wait one tick for store to hydrate before redirecting.
      const t = setTimeout(() => {
        if (!useWalletStore.getState().account) router.replace('/');
      }, 100);
      return () => clearTimeout(t);
    }
  }, [account, router]);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ amount: number; proofId?: string } | null>(null);

  const send = useCallback(async () => {
    if (!account) return;
    if (!recipient.trim()) return setError('Recipient required');
    const btcNum = parseFloat(amount);
    if (!btcNum || btcNum <= 0) return setError('Invalid amount');
    const sats = Math.round(btcNum * SATS_PER_BTC);
    if (sats > account.balance) return setError('Insufficient balance');

    setSending(true);
    setError(null);
    try {
      const wasm = await initWasm();
      if (!account.xpriv) throw new Error('No private key');
      const keys = wasm.derivePublicKeys(account.xpriv, account.numPubkeys);
      const res = await api.send({
        account_address: account.address,
        recipient: recipient.trim(),
        amount: sats,
        public_key: keys.publicKey,
        next_public_key: keys.nextPublicKey,
      });
      if (res.success) {
        incrementPubkeys();
        addTransaction({
          id: res.proof_id?.toString() ?? `send-${Date.now()}`,
          type: 'send',
          amount: sats,
          counterparty: recipient.trim(),
          timestamp: Date.now(),
          proofId: res.proof_id?.toString(),
        });
      }
      const { balance } = await api.balance(account.address);
      setBalance(balance);
      setSuccess({ amount: sats, proofId: res.proof_id?.toString() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }, [account, recipient, amount, setBalance, incrementPubkeys, addTransaction]);

  if (!account) {
    return (
      <AppShell showNav={false}>
        <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
          <Wallet size={36} strokeWidth={1.75} className="text-ink4" />
          <p className="mt-4 text-[14px] text-ink2">Redirecting to wallet…</p>
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
          <h1 className="mt-6 text-[22px] font-bold tracking-tight text-ink">Sent privately</h1>
          <p className="mt-2 mono text-[14px] text-ink2 tabular-nums">
            {formatBtcCompact(success.amount)} BTC
          </p>
          {success.proofId && (
            <p className="mt-4 mono text-[11px] text-ink4">proof #{success.proofId}</p>
          )}
          <button
            onClick={() => router.push('/')}
            className="mt-10 rounded-md bg-bitcoin px-8 py-3 text-[13px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover"
          >
            Done
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
          Back
        </Link>
        <span className="text-[11px] font-medium tracking-wider text-ink3 uppercase">Send</span>
      </header>

      <div className="mt-10 space-y-7">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink">Send Bitcoin</h1>
          <p className="mt-1 text-[13px] text-ink2">
            Privately. The chain never sees the amount or the recipient.
          </p>
        </div>

        {/* Available */}
        <div className="rounded-md border border-line bg-surface p-3 text-[12px]">
          <span className="text-ink3">Available </span>
          <span className="mono text-ink tabular-nums">{formatBtc(account.balance)} BTC</span>
        </div>

        {/* No-balance banner */}
        {account.balance <= 0 && (
          <div className="rounded-md border border-bitcoin/30 bg-bitcoin/5 p-3 text-[12px] leading-relaxed text-ink2">
            <span className="font-semibold text-bitcoin">No funds to send.</span>{' '}
            Use the faucet on the wallet screen, or get sats via{' '}
            <Link href="/receive" className="text-bitcoin hover:underline">
              Receive
            </Link>
            {' '}or{' '}
            <Link href="/apps" className="text-bitcoin hover:underline">
              DFX
            </Link>
            .
          </div>
        )}

        {/* Recipient */}
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink2">
            Recipient
          </label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="zs1qq…"
            className="w-full rounded-md border border-line2 bg-surface px-4 py-3 mono text-[14px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
          />
        </div>

        {/* Amount */}
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink2">Amount</label>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="0.00000000"
              className="w-full rounded-md border border-line2 bg-surface px-4 py-3 pr-20 mono text-[14px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] font-medium text-ink3">
              BTC
            </span>
          </div>
          <button
            onClick={() => setAmount(formatBtc(account.balance))}
            className="mt-2 text-[12px] font-medium text-bitcoin transition-colors hover:text-bitcoin-hover"
          >
            Set max
          </button>
        </div>

        {error && (
          <p className="text-[12px] text-bad">
            <span className="text-ink3">err:</span> {error}
          </p>
        )}

        <button
          onClick={send}
          disabled={sending || !recipient || !amount}
          className="w-full rounded-md bg-bitcoin py-4 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
        >
          {sending ? 'Creating proof…' : 'Send privately'}
        </button>
      </div>
    </AppShell>
  );
}
