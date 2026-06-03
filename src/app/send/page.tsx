'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Wallet } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { ApiError, JobFailedError, api, type JobStatus } from '@/lib/api/client';
import { userMessageFor } from '@/lib/api/errorMessages';
import { SATS_PER_BTC, formatBtc, formatBtcCompact } from '@/lib/format';
import { FEATURES } from '@/lib/features';

export default function SendPage() {
  const router = useRouter();
  const { account, balance, setBalance, incrementPubkeys, syncNumPubkeys, addTransaction } =
    useWalletStore();
  const usernameDomain = useNetworkStore((s) => s.usernameDomain);

  // Redirect to home (which handles unlock) if no account in memory.
  useEffect(() => {
    if (!account && typeof window !== 'undefined') {
      const t = setTimeout(() => {
        if (!useWalletStore.getState().account) router.replace('/');
      }, 100);
      return () => clearTimeout(t);
    }
  }, [account, router]);

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ amount: number; proofId?: string } | null>(null);

  const handleConfirm = useCallback(() => {
    if (!account || !recipient || !amount) return;
    const btcNum = parseFloat(amount);
    if (!btcNum || btcNum <= 0) {
      setError('Invalid amount');
      return;
    }
    const sats = Math.round(btcNum * SATS_PER_BTC);
    if (balance === null) {
      setError('Balance not loaded yet');
      return;
    }
    if (sats > balance) {
      setError('Insufficient balance');
      return;
    }
    setError(null);
    setConfirming(true);
  }, [account, balance, recipient, amount]);

  const send = useCallback(async () => {
    if (!account) return;
    setConfirming(false);
    const btcNum = parseFloat(amount);
    if (!btcNum || btcNum <= 0) return;
    const sats = Math.round(btcNum * SATS_PER_BTC);

    setSending(true);
    setPhase(null);
    setError(null);
    try {
      if (!account.xpriv) throw new Error('No private key');

      // Resolve username to address if the recipient looks like one.
      // Username resolve is MVP and always available on every node —
      // raw hex addresses skip the round-trip via the regex fast-path.
      let resolvedRecipient = recipient.trim();
      if (resolvedRecipient.startsWith('$')) {
        resolvedRecipient = resolvedRecipient.slice(1);
      }
      // Only strip the suffix the server reports for itself. A
      // DEV-suffixed recipient (`…@dev.zkcoins.app`) entered on a PRD
      // wallet must NOT be stripped — it falls through to
      // `api.resolveUsername(…)` and gets a clean 404 instead of
      // silently routing against the wrong stage.
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

      // Drive the async Jobs-API send lifecycle. `api.send` re-fetches
      // the balance to hydrate the BIP-32 child index from the server's
      // authoritative `num_sends` before signing (thin-client invariant),
      // admits the send job, polls to `awaiting_signature`, builds the
      // commitment from the JSON `result` (no binary decode, no fabricated
      // commitment), attaches it, and polls to `completed`. The job's
      // phase transitions drive the inline progress label.
      const result = await api.send(
        {
          account_address: account.address,
          recipient: resolvedRecipient,
          amount: sats,
          xpriv: account.xpriv,
        },
        { onPhase: (job: JobStatus) => setPhase(job.phase) },
      );

      const proofId = result.result?.proof_id ?? undefined;

      incrementPubkeys();
      addTransaction({
        id: proofId?.toString() ?? `send-${Date.now()}`,
        type: 'send',
        amount: sats,
        counterparty: recipient.trim(),
        timestamp: Date.now(),
        proofId: proofId?.toString(),
      });

      const postSend = await api.balance(account.address);
      setBalance(postSend.balance);
      // Re-sync from the server after the commit phase landed so the
      // store reflects the bumped counter (server's `num_sends` should
      // now be the next index). `incrementPubkeys()` above already
      // advanced the local counter — this is the belt-and-braces tick
      // against the server's source of truth.
      syncNumPubkeys(postSend.num_sends);
      setSuccess({ amount: sats, proofId: proofId?.toString() });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(userMessageFor(err));
      } else if (err instanceof JobFailedError) {
        setError(err.detail ?? `Transaction ${err.jobStatus}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Send failed');
      }
    } finally {
      setSending(false);
      setPhase(null);
    }
  }, [
    account,
    recipient,
    amount,
    usernameDomain,
    setBalance,
    incrementPubkeys,
    syncNumPubkeys,
    addTransaction,
  ]);

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
            Sent privately
          </h1>
          <p className="mt-2 mono text-[14px] text-ink2 tabular-nums">
            {formatBtcCompact(success.amount)} BTC
          </p>
          {success.proofId && (
            <p data-testid="proof-id" className="mt-4 mono text-[11px] text-ink4">
              proof #{success.proofId}
            </p>
          )}
          <button
            aria-label="Return to wallet"
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

      <form
        className="mt-10 space-y-7"
        onSubmit={(e) => {
          e.preventDefault();
          handleConfirm();
        }}
      >
        <div>
          <h1 data-testid="send-heading" className="text-[26px] font-bold tracking-tight text-ink">
            Send Bitcoin
          </h1>
          <p className="mt-1 text-[13px] text-ink2">
            Privately. The chain never sees the amount or the recipient.
          </p>
        </div>

        {/* Available */}
        <div className="rounded-md border border-line bg-surface p-3 text-[12px]">
          <span className="text-ink3">Available </span>
          <span
            data-testid="send-available"
            data-loading={balance === null || undefined}
            className="mono text-ink tabular-nums"
          >
            {balance === null ? '— BTC' : `${formatBtc(balance)} BTC`}
          </span>
        </div>

        {/* No-balance banner — only after the first balance tick, never during loading. */}
        {balance === 0 && (
          <div
            data-testid="send-no-funds-banner"
            className="rounded-md border border-bitcoin/30 bg-bitcoin/5 p-3 text-[12px] leading-relaxed text-ink2"
          >
            <span className="font-semibold text-bitcoin">No funds to send.</span> Get sats via{' '}
            <Link href="/receive" className="text-bitcoin hover:underline">
              Receive
            </Link>
            {FEATURES.APPS_DIRECTORY && (
              <>
                {' '}
                or{' '}
                <Link href="/apps" className="text-bitcoin hover:underline">
                  DFX
                </Link>
              </>
            )}
            .
          </div>
        )}

        {/* Recipient */}
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink2">Recipient</label>
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
        </div>

        {/* Amount */}
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink2">Amount</label>
          <div className="relative">
            <input
              data-testid="send-amount-input"
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
            type="button"
            data-testid="send-setmax-btn"
            onClick={() => {
              if (balance !== null && balance > 0) setAmount(formatBtc(balance));
            }}
            disabled={balance === null || balance === 0}
            className="mt-2 text-[12px] font-medium text-bitcoin transition-colors hover:text-bitcoin-hover disabled:cursor-not-allowed disabled:text-ink4"
          >
            Set max
          </button>
        </div>

        {error && (
          <p data-testid="send-error" className="text-[12px] text-bad">
            <span className="text-ink3">err:</span> {error}
          </p>
        )}

        {confirming ? (
          <div
            data-testid="send-confirm-card"
            className="space-y-4 rounded-md border border-bitcoin/30 bg-bitcoin/5 p-4"
          >
            <p className="text-[13px] text-ink">
              Send{' '}
              <span className="mono font-semibold">
                {formatBtcCompact(Math.round(parseFloat(amount) * SATS_PER_BTC))} BTC
              </span>{' '}
              to:
            </p>
            <p className="mono break-all text-[12px] text-ink2">{recipient}</p>
            <p className="text-[11px] text-ink3">This cannot be undone.</p>
            <div className="flex gap-3">
              <button
                type="button"
                data-testid="send-cancel-btn"
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-md border border-line2 py-3 text-[13px] text-ink2 transition-colors hover:border-ink2 hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="send-confirm-btn"
                onClick={send}
                disabled={sending}
                className="flex-1 rounded-md bg-bitcoin py-3 text-[13px] font-semibold text-bg transition-colors hover:bg-bitcoin-hover disabled:bg-line disabled:text-ink4"
              >
                {sending ? 'Creating proof…' : 'Confirm Send'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="submit"
            data-testid="send-submit-btn"
            disabled={sending || !recipient || !amount}
            className="w-full rounded-md bg-bitcoin py-4 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
          >
            Send privately
          </button>
        )}

        {sending && phase && (
          <p data-testid="send-phase" className="text-center text-[11px] text-ink3">
            {phase}
          </p>
        )}
      </form>
    </AppShell>
  );
}
