'use client';

import { useState, useEffect, useCallback } from 'react';
import { initWasm, type ZkCoinsWasm } from '@zkcoins/wasm';
import { useWalletStore } from '@/stores/wallet';
import { api } from '@/lib/api/client';

export function useZkCoins() {
  const [wasm, setWasm] = useState<ZkCoinsWasm | null>(null);
  const [isReady, setIsReady] = useState(false);
  const { setAccount, setBalance, setLoading, setError, incrementPubkeys, addTransaction } =
    useWalletStore();

  useEffect(() => {
    initWasm()
      .then((w) => {
        setWasm(w);
        setIsReady(true);
      })
      .catch(() => {
        setIsReady(true);
      });
  }, []);

  const createAccount = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const w = wasm || (await initWasm());
      const accountData = await w.createAccount();

      const newAccount = {
        address: accountData.address,
        balance: 0,
        numPubkeys: accountData.numPubkeys,
        xpriv: accountData.xpriv,
      };
      setAccount(newAccount);

      await api.mint(accountData.address);
      const { balance } = await api.balance(accountData.address);
      setBalance(balance);

      addTransaction({
        id: `mint-${Date.now()}`,
        type: 'mint',
        amount: balance,
        timestamp: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setLoading(false);
    }
  }, [wasm, setAccount, setBalance, setLoading, setError, addTransaction]);

  const sendCoins = useCallback(
    async (recipient: string, amount: number) => {
      const { account } = useWalletStore.getState();
      if (!account) throw new Error('No account');

      setLoading(true);
      setError(null);
      try {
        const w = wasm || (await initWasm());
        if (!account.xpriv) {
          throw new Error('No private key available');
        }

        const keys = w.derivePublicKeys(account.xpriv, account.numPubkeys);
        const prevPk =
          account.numPubkeys > 0
            ? w.derivePublicKeys(account.xpriv, account.numPubkeys - 1).publicKey
            : undefined;

        const res = await api.send({
          account_address: account.address,
          recipient,
          amount,
          public_key: keys.publicKey,
          next_public_key: keys.nextPublicKey,
          prev_commitment_pubkey: prevPk,
        });

        if (res.success) {
          incrementPubkeys();
          addTransaction({
            id: res.proof_id?.toString() ?? `send-${Date.now()}`,
            type: 'send',
            amount,
            counterparty: recipient,
            timestamp: Date.now(),
            proofId: res.proof_id?.toString(),
          });
        }

        const { balance } = await api.balance(account.address);
        setBalance(balance);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Send failed');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [wasm, setBalance, setLoading, setError, incrementPubkeys, addTransaction],
  );

  return { isReady, createAccount, sendCoins };
}
