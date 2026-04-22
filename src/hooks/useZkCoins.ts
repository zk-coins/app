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
        setIsReady(true); // fallback mode
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
      };
      setAccount(newAccount);

      await api.mint({ address: accountData.address });
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
        const res = await api.send({
          sender: account.address,
          recipient,
          amount,
          sender_public_key: '',
          sender_next_public_key: '',
        });

        incrementPubkeys();
        addTransaction({
          id: res.proof_id,
          type: 'send',
          amount,
          counterparty: recipient,
          timestamp: Date.now(),
          proofId: res.proof_id,
        });

        const { balance } = await api.balance(account.address);
        setBalance(balance);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Send failed');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [setBalance, setLoading, setError, incrementPubkeys, addTransaction],
  );

  return { isReady, createAccount, sendCoins };
}
