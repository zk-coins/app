'use client';

import { useState, useCallback, useEffect } from 'react';
import { useWalletStore } from '@/stores/wallet';
import { api, type CommitRequest } from '@/lib/api/client';
import { initWasm } from '@zkcoins/wasm';

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

export function SendForm() {
  const { account, setBalance, incrementPubkeys, addTransaction } = useWalletStore();
  const [recovering, setRecovering] = useState(false);
  const [recipient, setRecipient] = useState('');

  // Recover incomplete commits from previous session
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
        // Keep in localStorage for next retry
      })
      .finally(() => setRecovering(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleConfirm = useCallback(() => {
    if (!account || !recipient || !amount) return;
    const amountNum = parseInt(amount, 10);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Invalid amount');
      return;
    }
    if (amountNum > account.balance) {
      setError('Insufficient balance');
      return;
    }
    setError(null);
    setConfirming(true);
  }, [account, recipient, amount]);

  const handleSend = useCallback(async () => {
    if (!account || !recipient || !amount) return;
    setConfirming(false);

    const amountNum = parseInt(amount, 10);
    if (isNaN(amountNum) || amountNum <= 0) return;

    setSending(true);
    setError(null);
    setSuccess(null);

    try {
      // Resolve username to address if needed
      let resolvedRecipient = recipient.trim();

      // Strip UMA format: $alice@zkcoins.app → alice
      if (resolvedRecipient.startsWith('$')) {
        resolvedRecipient = resolvedRecipient.slice(1);
      }
      if (resolvedRecipient.endsWith('@zkcoins.app')) {
        resolvedRecipient = resolvedRecipient.replace('@zkcoins.app', '');
      }

      // If it doesn't look like a hex address, treat it as a username
      if (!resolvedRecipient.startsWith('0x') && !/^[0-9a-f]{64}$/i.test(resolvedRecipient)) {
        const resolved = await api.resolveUsername(resolvedRecipient);
        resolvedRecipient = resolved.address;
      }

      const wasm = await initWasm();
      if (!account.xpriv) {
        throw new Error('No private key available — account was created without WASM');
      }

      const keys = wasm.derivePublicKeys(account.xpriv, account.numPubkeys);
      const prevPk =
        account.numPubkeys > 0
          ? wasm.derivePublicKeys(account.xpriv, account.numPubkeys - 1).publicKey
          : undefined;

      const res = await api.sendSigned(
        {
          account_address: account.address,
          recipient: resolvedRecipient,
          amount: amountNum,
          public_key: keys.publicKey,
          next_public_key: keys.nextPublicKey,
          prev_commitment_pubkey: prevPk,
        },
        account.xpriv,
        account.numPubkeys,
      );

      if (res.success) {
        // Phase 2: Create and submit commitment so the recipient receives the coins
        if (res.account_state_hash && res.output_coins_root && res.proof_id) {
          const commitment = wasm.createCommitment(
            account.xpriv,
            account.numPubkeys,
            res.account_state_hash,
            res.output_coins_root,
          );
          const commitPayload = {
            proof_id: res.proof_id,
            public_key: commitment.publicKey,
            signature: commitment.signature,
            message: commitment.message,
          };

          // Persist in-flight commit before attempting (crash recovery)
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
          amount: amountNum,
          counterparty: recipient,
          timestamp: Date.now(),
          proofId: res.proof_id?.toString(),
        });
      }

      const { balance } = await api.balance(account.address);
      setBalance(balance);

      setSuccess(`Sent ${amountNum} sats`);
      setRecipient('');
      setAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }, [account, recipient, amount, setBalance, incrementPubkeys, addTransaction]);

  return (
    <div className="rounded-xl border border-zkcoins-border bg-zkcoins-card p-6">
      <h3 className="mb-4 text-sm font-semibold text-white">Send</h3>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-zkcoins-muted">Recipient</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="$alice@zkcoins.app or 0x..."
            className="w-full rounded-lg border border-zkcoins-border bg-zkcoins-bg px-3 py-2 text-sm text-white placeholder-zkcoins-muted outline-none focus:border-bitcoin"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zkcoins-muted">Amount (sats)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            min="1"
            className="w-full rounded-lg border border-zkcoins-border bg-zkcoins-bg px-3 py-2 text-sm text-white placeholder-zkcoins-muted outline-none focus:border-bitcoin"
          />
        </div>
        {confirming ? (
          <div className="space-y-3 rounded-lg border border-bitcoin/30 bg-bitcoin/5 p-4">
            <p className="text-sm text-white">
              Send <span className="font-bold">{parseInt(amount, 10).toLocaleString()} sats</span>{' '}
              to:
            </p>
            <p className="break-all text-xs text-white/70">{recipient}</p>
            <p className="text-xs text-zkcoins-muted">This cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-lg border border-zkcoins-border py-2 text-sm text-zkcoins-muted transition-colors hover:border-white/30 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                className="flex-1 rounded-lg bg-bitcoin py-2 text-sm font-semibold text-black transition-colors hover:bg-bitcoin-dark"
              >
                Confirm Send
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleConfirm}
            disabled={sending || !recipient || !amount}
            className="w-full rounded-lg bg-bitcoin py-2.5 font-semibold text-black transition-colors hover:bg-bitcoin-dark disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Send Coins'}
          </button>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {success && <p className="text-sm text-green-400">{success}</p>}
      </div>
    </div>
  );
}
