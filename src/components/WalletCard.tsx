'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api/client';
import { initWasm } from '@zkcoins/wasm';
import { isPasskeySupported } from '@/lib/crypto/passkey';
import { SeedPhraseSetup } from './SeedPhraseSetup';
import { SeedPhraseImport } from './SeedPhraseImport';
import { PasskeySetup } from './PasskeySetup';

type AuthView = 'choose' | 'passkey-create' | 'passkey-restore' | 'seed-create' | 'seed-import';

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

  const { setAuth, loadFromStorage: loadAuth } = useAuthStore();
  const [authView, setAuthView] = useState<AuthView>('choose');
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  useEffect(() => {
    loadFromStorage();
    loadAuth();
    setPasskeyAvailable(isPasskeySupported());
  }, [loadFromStorage, loadAuth]);

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

  const createFromMnemonic = useCallback(
    async (mnemonic: string) => {
      setLoading(true);
      setError(null);
      try {
        const wasm = await initWasm();
        const accountData = await wasm.createAccountFromMnemonic(mnemonic);
        const newAccount = {
          address: accountData.address,
          balance: 0,
          numPubkeys: accountData.numPubkeys,
          xpriv: accountData.xpriv,
        };
        setAccount(newAccount);
        setAuth('seed');

        try {
          await api.mint(accountData.address);
          const { balance } = await api.balance(accountData.address);
          setBalance(balance);
        } catch {
          // mint may fail — account is still created
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create account');
      } finally {
        setLoading(false);
      }
    },
    [setAccount, setBalance, setLoading, setError, setAuth],
  );

  const restoreFromMnemonic = useCallback(
    async (mnemonic: string) => {
      setLoading(true);
      setError(null);
      try {
        const wasm = await initWasm();
        const accountData = await wasm.createAccountFromMnemonic(mnemonic);
        const newAccount = {
          address: accountData.address,
          balance: 0,
          numPubkeys: accountData.numPubkeys,
          xpriv: accountData.xpriv,
        };
        setAccount(newAccount);
        setAuth('seed');

        try {
          const { balance } = await api.balance(accountData.address);
          setBalance(balance);
        } catch {
          // balance fetch may fail — account is still restored
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to restore account');
      } finally {
        setLoading(false);
      }
    },
    [setAccount, setBalance, setLoading, setError, setAuth],
  );

  const createFromPasskey = useCallback(
    async (mnemonic: string, credentialId: string) => {
      setLoading(true);
      setError(null);
      try {
        const wasm = await initWasm();
        const accountData = await wasm.createAccountFromMnemonic(mnemonic);
        const newAccount = {
          address: accountData.address,
          balance: 0,
          numPubkeys: accountData.numPubkeys,
          xpriv: accountData.xpriv,
        };
        setAccount(newAccount);
        setAuth('passkey', credentialId);

        try {
          await api.mint(accountData.address);
          const { balance } = await api.balance(accountData.address);
          setBalance(balance);
        } catch {
          // mint may fail — account is still created
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create account');
      } finally {
        setLoading(false);
      }
    },
    [setAccount, setBalance, setLoading, setError, setAuth],
  );

  const restoreFromPasskey = useCallback(
    async (mnemonic: string, credentialId: string) => {
      setLoading(true);
      setError(null);
      try {
        const wasm = await initWasm();
        const accountData = await wasm.createAccountFromMnemonic(mnemonic);
        const newAccount = {
          address: accountData.address,
          balance: 0,
          numPubkeys: accountData.numPubkeys,
          xpriv: accountData.xpriv,
        };
        setAccount(newAccount);
        setAuth('passkey', credentialId);

        try {
          const { balance } = await api.balance(accountData.address);
          setBalance(balance);
        } catch {
          // balance fetch may fail — account is still restored
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to restore account');
      } finally {
        setLoading(false);
      }
    },
    [setAccount, setBalance, setLoading, setError, setAuth],
  );

  if (!account) {
    if (authView === 'passkey-create') {
      return (
        <PasskeySetup
          mode="create"
          onComplete={createFromPasskey}
          onBack={() => setAuthView('choose')}
        />
      );
    }

    if (authView === 'passkey-restore') {
      return (
        <PasskeySetup
          mode="restore"
          onComplete={restoreFromPasskey}
          onBack={() => setAuthView('choose')}
        />
      );
    }

    if (authView === 'seed-create') {
      return (
        <SeedPhraseSetup onComplete={createFromMnemonic} onBack={() => setAuthView('choose')} />
      );
    }

    if (authView === 'seed-import') {
      return (
        <SeedPhraseImport onComplete={restoreFromMnemonic} onBack={() => setAuthView('choose')} />
      );
    }

    return (
      <div className="rounded-xl border border-zkcoins-border bg-zkcoins-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-bitcoin/10">
          <span className="text-2xl text-bitcoin">+</span>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-white">Create Wallet</h2>
        <p className="mb-6 text-sm text-zkcoins-muted">
          Create a new wallet or restore an existing one.
        </p>
        <div className="flex flex-col items-center gap-3">
          {passkeyAvailable && (
            <button
              onClick={() => setAuthView('passkey-create')}
              disabled={isLoading}
              className="w-64 rounded-lg bg-bitcoin px-6 py-3 font-semibold text-black transition-colors hover:bg-bitcoin-dark disabled:opacity-50"
            >
              Create with Passkey
            </button>
          )}
          <button
            onClick={() => setAuthView('seed-create')}
            disabled={isLoading}
            className={`w-64 rounded-lg px-6 py-3 font-semibold transition-colors disabled:opacity-50 ${
              passkeyAvailable
                ? 'border border-zkcoins-border text-sm text-zkcoins-muted hover:border-bitcoin hover:text-bitcoin'
                : 'bg-bitcoin text-black hover:bg-bitcoin-dark'
            }`}
          >
            {passkeyAvailable ? 'Create with Seed Phrase' : 'New Wallet'}
          </button>
          <div className="mt-2 border-t border-zkcoins-border pt-4">
            <p className="mb-3 text-xs text-zkcoins-muted">Restore existing wallet</p>
            <div className="flex flex-col items-center gap-2">
              {passkeyAvailable && (
                <button
                  onClick={() => setAuthView('passkey-restore')}
                  disabled={isLoading}
                  className="w-64 rounded-lg border border-zkcoins-border px-5 py-2 text-sm text-zkcoins-muted transition-colors hover:border-bitcoin hover:text-bitcoin disabled:opacity-50"
                >
                  Restore with Passkey
                </button>
              )}
              <button
                onClick={() => setAuthView('seed-import')}
                disabled={isLoading}
                className="w-64 rounded-lg border border-zkcoins-border px-5 py-2 text-sm text-zkcoins-muted transition-colors hover:border-bitcoin hover:text-bitcoin disabled:opacity-50"
              >
                Restore from Seed Phrase
              </button>
            </div>
          </div>
        </div>
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
              await api.mint(account.address);
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
