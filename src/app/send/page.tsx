'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Wallet } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';
import { ApiError, api, type CommitRequest } from '@/lib/api/client';
import { userMessageFor } from '@/lib/api/errorMessages';
import { initWasm } from '@zkcoins/wasm';
import { SATS_PER_BTC, formatBtc, formatBtcCompact } from '@/lib/format';
import { FEATURES } from '@/lib/features';

/* --- In-flight commit crash recovery --- */

const INFLIGHT_KEY = 'zkcoins_inflight_commit';

function saveInflightCommit(payload: CommitRequest): void {
  localStorage.setItem(INFLIGHT_KEY, JSON.stringify(payload));
}
function clearInflightCommit(): void {
  localStorage.removeItem(INFLIGHT_KEY);
}
function getInflightCommit(): CommitRequest | null {
  const raw = localStorage.getItem(INFLIGHT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function SendPage() {
  const router = useRouter();
  const { account, balance, setBalance, incrementPubkeys, addTransaction } = useWalletStore();

  // Redirect to home (which handles unlock) if no account in memory.
  useEffect(() => {
    if (!account && typeof window !== 'undefined') {
      const t = setTimeout(() => {
        if (!useWalletStore.getState().account) router.replace('/');
      }, 100);
      return () => clearTimeout(t);
    }
  }, [account, router]);

  // Recover incomplete commits from previous session.
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    const inflight = getInflightCommit();
    if (!inflight) return;
    setRecovering(true);
    api
      .commit(inflight)
      .then(() => {
        clearInflightCommit();
        incrementPubkeys();
        if (account) api.balance(account.address).then(({ balance }) => setBalance(balance));
      })
      .catch(() => {
        // Keep in localStorage for next retry.
      })
      .finally(() => setRecovering(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
    setError(null);
    try {
      // Resolve username to address if the recipient looks like one.
      // Username resolution itself is gated by `NEXT_PUBLIC_ENABLE_USERNAMES`;
      // when disabled, only raw hex addresses are accepted and the resolver
      // code (including the `api.resolveUsername` call) is dead.
      let resolvedRecipient = recipient.trim();
      if (FEATURES.USERNAMES) {
        if (resolvedRecipient.startsWith('$')) {
          resolvedRecipient = resolvedRecipient.slice(1);
        }
        if (resolvedRecipient.endsWith('@zkcoins.app')) {
          resolvedRecipient = resolvedRecipient.replace('@zkcoins.app', '');
        }
        if (!resolvedRecipient.startsWith('0x') && !/^[0-9a-f]{64}$/i.test(resolvedRecipient)) {
          const resolved = await api.resolveUsername(resolvedRecipient);
          resolvedRecipient = resolved.address;
        }
      }

      const wasm = await initWasm();
      if (!account.xpriv) throw new Error('No private key');

      const keys = wasm.derivePublicKeys(account.xpriv, account.numPubkeys);
      const prevPk =
        account.numPubkeys > 0
          ? wasm.derivePublicKeys(account.xpriv, account.numPubkeys - 1).publicKey
          : undefined;

      const res = await api.sendSigned(
        {
          account_address: account.address,
          recipient: resolvedRecipient,
          amount: sats,
          public_key: keys.publicKey,
          next_public_key: keys.nextPublicKey,
          prev_commitment_pubkey: prevPk,
        },
        account.xpriv,
        account.numPubkeys,
      );

      // Pre-PR-#31 servers reply 200 + `{success: false}` (no error
      // string). Normalise to ApiError so the catch path treats both
      // contracts uniformly.
      if (!res.success) {
        throw new ApiError(200, res.error ?? 'legacy: success false with no error string');
      }

      // Phase 2: Create and submit commitment so the recipient receives the coins.
      if (res.account_state_hash && res.output_coins_root && res.proof_id) {
        const commitment = wasm.createCommitment(
          account.xpriv,
          account.numPubkeys,
          res.account_state_hash,
          res.output_coins_root,
        );
        const commitPayload: CommitRequest = {
          proof_id: res.proof_id,
          public_key: commitment.publicKey,
          signature: commitment.signature,
          message: commitment.message,
        };

        // Persist in-flight commit before attempting (crash recovery).
        saveInflightCommit(commitPayload);

        let committed = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await api.commit(commitPayload);
            committed = true;
            clearInflightCommit();
            break;
          } catch {
            if (attempt < 2) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          }
        }

        if (!committed) {
          throw new Error(
            'Transaction sent but delivery to recipient failed. ' +
              'The app will retry automatically on next load.',
          );
        }
      }

      incrementPubkeys();
      addTransaction({
        id: res.proof_id?.toString() ?? `send-${Date.now()}`,
        type: 'send',
        amount: sats,
        counterparty: recipient.trim(),
        timestamp: Date.now(),
        proofId: res.proof_id?.toString(),
      });

      const { balance } = await api.balance(account.address);
      setBalance(balance);
      setSuccess({ amount: sats, proofId: res.proof_id?.toString() });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(userMessageFor(err));
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Send failed');
      }
    } finally {
      setSending(false);
    }
  }, [account, recipient, amount, setBalance, incrementPubkeys, addTransaction]);

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

        {recovering && (
          <div
            data-testid="send-recovering-banner"
            className="rounded-md border border-bitcoin/30 bg-bitcoin/5 p-3 text-[12px] text-ink2"
          >
            Recovering a previous in-flight transaction…
          </div>
        )}

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
            placeholder={FEATURES.USERNAMES ? 'alice@zkcoins.app' : '0x…'}
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
      </form>
    </AppShell>
  );
}
