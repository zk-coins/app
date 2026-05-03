'use client';

import { useEffect, useCallback } from 'react';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { api } from '@/lib/api/client';
import { initWasm } from '@zkcoins/wasm';

export function WalletCard() {
  const {
    account,
    isLoading,
    error,
    setAccount,
    setBalance,
    setLoading,
    setError,
    loadFromStorage,
  } = useWalletStore();
  const activeNetwork = useNetworkStore((s) => s.activeNetwork);

  useEffect(() => {
    loadFromStorage();
  }, [activeNetwork, loadFromStorage]);

  useEffect(() => {
    if (!account) return;
    const interval = setInterval(async () => {
      try {
        const { balance } = await api.balance(account.address);
        setBalance(balance);
      } catch {
        // silently ignore polling errors
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [account, setBalance]);

  const createAccount = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const wasm = await initWasm();
      const accountData = await wasm.createAccount();
      const newAccount = { address: accountData.address, balance: 0, numPubkeys: 0 };
      setAccount(newAccount);
      const address = accountData.address;

      // Mint initial coins
      await api.mint({ address });
      const { balance } = await api.balance(address);
      setBalance(balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setLoading(false);
    }
  }, [setAccount, setBalance, setLoading, setError]);

  if (!account) {
    return (
      <div className="rounded-xl border border-zkcoins-border bg-zkcoins-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-bitcoin/10">
          <span className="text-2xl text-bitcoin">+</span>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-white">Create Wallet</h2>
        <p className="mb-6 text-sm text-zkcoins-muted">
          Generate a new HD wallet with BIP32 key derivation. Your keys stay local.
        </p>
        <button
          onClick={createAccount}
          disabled={isLoading}
          className="rounded-lg bg-bitcoin px-6 py-3 font-semibold text-black transition-colors hover:bg-bitcoin-dark disabled:opacity-50"
        >
          {isLoading ? 'Creating...' : 'Create Account'}
        </button>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zkcoins-border bg-zkcoins-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-zkcoins-muted">Balance</span>
        <button
          onClick={async () => {
            try {
              await api.mint({ address: account.address });
              const { balance } = await api.balance(account.address);
              setBalance(balance);
            } catch {
              // ignore
            }
          }}
          className="rounded-md border border-zkcoins-border px-3 py-1 text-xs text-zkcoins-muted transition-colors hover:border-bitcoin hover:text-bitcoin"
        >
          Faucet
        </button>
      </div>
      <div className="mb-6">
        <span className="text-4xl font-bold text-white">{account.balance.toLocaleString()}</span>
        <span className="ml-2 text-lg text-zkcoins-muted">sats</span>
      </div>
      <div className="rounded-lg bg-zkcoins-bg p-3">
        <span className="text-xs text-zkcoins-muted">Address</span>
        <p className="mt-1 break-all text-xs text-white/70">{account.address}</p>
      </div>
    </div>
  );
}
