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
import { SetPassword } from './SetPassword';
import { UnlockWallet } from './UnlockWallet';

type AuthView =
  | 'choose'
  | 'passkey-create'
  | 'passkey-restore'
  | 'seed-create'
  | 'seed-import'
  | 'set-password';

export function WalletCard() {
  const {
    account,
    isLoading,
    isLocked,
    hasStoredWallet,
    error,
    setAccount,
    setBalance,
    setUsername,
    setLoading,
    setError,
    saveWithPassword,
    saveWithPrf,
    checkForStoredWallet,
  } = useWalletStore();

  const { setAuth, hydrate } = useAuthStore();
  const [authView, setAuthView] = useState<AuthView>('choose');
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [pendingMnemonic, setPendingMnemonic] = useState<string | null>(null);
  const [pendingIsNew, setPendingIsNew] = useState(false);
  const [claimInput, setClaimInput] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    checkForStoredWallet();
    hydrate();
    setPasskeyAvailable(isPasskeySupported());
  }, [checkForStoredWallet, hydrate]);

  useEffect(() => {
    if (!account) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.balance(account.address);
        setBalance(res.balance);
        if (res.username && !account.username) {
          setUsername(res.username);
        }
      } catch {
        // silently ignore polling errors
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [account, setBalance, setUsername]);

  // Seed phrase flow: store mnemonic, go to password screen FIRST
  const onMnemonicReady = useCallback((mnemonic: string, isNew: boolean) => {
    setPendingMnemonic(mnemonic);
    setPendingIsNew(isNew);
    setAuthView('set-password');
  }, []);

  // After password is set: create account, encrypt, save, then mint
  const handlePasswordSet = useCallback(
    async (password: string) => {
      if (!pendingMnemonic) return;
      setLoading(true);
      setError(null);
      try {
        const wasm = await initWasm();
        const accountData = await wasm.createAccountFromMnemonic(pendingMnemonic);
        const newAccount = {
          address: accountData.address,
          balance: 0,
          numPubkeys: accountData.numPubkeys,
          xpriv: accountData.xpriv,
        };
        setAccount(newAccount);
        setAuth('seed');
        await saveWithPassword(password);

        setPendingMnemonic(null);
        setAuthView('choose');

        if (pendingIsNew) {
          try {
            await api.mint(accountData.address);
            const { balance } = await api.balance(accountData.address);
            setBalance(balance);
          } catch {
            // mint may fail — wallet is already saved
          }
        } else {
          try {
            const { balance } = await api.balance(accountData.address);
            setBalance(balance);
          } catch {
            // balance fetch may fail
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create wallet');
      } finally {
        setLoading(false);
      }
    },
    [
      pendingMnemonic,
      pendingIsNew,
      setAccount,
      setBalance,
      setLoading,
      setError,
      setAuth,
      saveWithPassword,
    ],
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

        // For passkey, PRF output is not available here anymore.
        // The PasskeySetup already saved credential metadata.
        // We need to re-authenticate to get PRF for encryption.
        // Instead, we authenticate again to encrypt the wallet.
        const { authenticatePasskey } = await import('@/lib/crypto/passkey');
        const result = await authenticatePasskey(credentialId);
        await saveWithPrf(result.prfOutput);

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
    [setAccount, setBalance, setLoading, setError, setAuth, saveWithPrf],
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

        const { authenticatePasskey } = await import('@/lib/crypto/passkey');
        const result = await authenticatePasskey(credentialId);
        await saveWithPrf(result.prfOutput);

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
    [setAccount, setBalance, setLoading, setError, setAuth, saveWithPrf],
  );

  // Show unlock screen for stored encrypted wallet
  if ((isLocked || hasStoredWallet) && !account) {
    return <UnlockWallet />;
  }

  if (!account) {
    if (authView === 'set-password') {
      return <SetPassword onComplete={handlePasswordSet} />;
    }

    if (authView === 'passkey-create') {
      return (
        <PasskeySetup
          mode="create"
          onComplete={createFromPasskey}
          onBack={() => {
            setAuthView('choose');
            setPendingMnemonic(null);
          }}
        />
      );
    }

    if (authView === 'passkey-restore') {
      return (
        <PasskeySetup
          mode="restore"
          onComplete={restoreFromPasskey}
          onBack={() => {
            setAuthView('choose');
            setPendingMnemonic(null);
          }}
        />
      );
    }

    if (authView === 'seed-create') {
      return (
        <SeedPhraseSetup
          onComplete={(m) => onMnemonicReady(m, true)}
          onBack={() => {
            setAuthView('choose');
            setPendingMnemonic(null);
          }}
        />
      );
    }

    if (authView === 'seed-import') {
      return (
        <SeedPhraseImport
          onComplete={(m) => onMnemonicReady(m, false)}
          onBack={() => {
            setAuthView('choose');
            setPendingMnemonic(null);
          }}
        />
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

  // Account exists — show set-password if needed for seed wallets
  if (authView === 'set-password') {
    return <SetPassword onComplete={handlePasswordSet} />;
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
        <p className="mt-1 text-sm font-medium text-white">
          {account.username || account.address.replace(/^0x/, '').slice(0, 8)}@zkcoins.app
        </p>
        {!account.username && (
          <div className="mt-2">
            {claimInput !== null && claiming !== undefined ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={claimInput}
                  onChange={(e) => {
                    setClaimInput(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''));
                    setClaimError(null);
                  }}
                  placeholder="Custom name"
                  className="flex-1 rounded-md border border-zkcoins-border bg-zkcoins-card px-2 py-1 text-xs text-white placeholder-zkcoins-muted outline-none focus:border-bitcoin"
                />
                <button
                  onClick={async () => {
                    if (!claimInput || !account.xpriv) return;
                    setClaiming(true);
                    setClaimError(null);
                    try {
                      const res = await api.claimUsername({
                        username: claimInput,
                        address: account.address,
                        xpriv: account.xpriv,
                      });
                      setUsername(res.username);
                      setClaimInput('');
                    } catch (err) {
                      setClaimError(err instanceof Error ? err.message : 'Claim failed');
                    } finally {
                      setClaiming(false);
                    }
                  }}
                  disabled={claiming || !claimInput}
                  className="rounded-md bg-bitcoin px-3 py-1 text-xs font-semibold text-black transition-colors hover:bg-bitcoin-dark disabled:opacity-50"
                >
                  {claiming ? '...' : 'Claim'}
                </button>
              </div>
            ) : null}
            {claimError && <p className="mt-1 text-xs text-red-400">{claimError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
