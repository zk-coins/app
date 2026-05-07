'use client';

import { useState, useCallback } from 'react';
import { useWalletStore } from '@/stores/wallet';
import { api } from '@/lib/api/client';
import { initWasm } from '@zkcoins/wasm';

export function SendForm() {
  const { account, setBalance, incrementPubkeys, addTransaction } = useWalletStore();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSend = useCallback(async () => {
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

    setSending(true);
    setError(null);
    setSuccess(null);

    try {
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
          recipient,
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
          await api.commit({
            proof_id: res.proof_id,
            public_key: commitment.publicKey,
            signature: commitment.signature,
            message: commitment.message,
          });
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
          <label className="mb-1 block text-xs text-zkcoins-muted">Recipient Address</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x..."
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
        <button
          onClick={handleSend}
          disabled={sending || !recipient || !amount}
          className="w-full rounded-lg bg-bitcoin py-2.5 font-semibold text-black transition-colors hover:bg-bitcoin-dark disabled:opacity-50"
        >
          {sending ? 'Sending...' : 'Send Coins'}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {success && <p className="text-sm text-green-400">{success}</p>}
      </div>
    </div>
  );
}
