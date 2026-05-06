'use client';

import { useState, useCallback } from 'react';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { authenticatePasskey } from '@/lib/crypto/passkey';

export function UnlockWallet() {
  const { storedAddress, storedAuthMethod, unlockWithPassword, unlockWithPrf, deleteWallet } =
    useWalletStore();
  const { credentialId } = useAuthStore();
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  const handlePasskeyUnlock = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await authenticatePasskey(credentialId ?? undefined);
      await unlockWithPrf(result.prfOutput);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock');
    } finally {
      setIsLoading(false);
    }
  }, [credentialId, unlockWithPrf]);

  const handlePasswordUnlock = useCallback(async () => {
    if (!password) return;
    setIsLoading(true);
    setError(null);
    try {
      await unlockWithPassword(password);
    } catch {
      setError('Incorrect password');
    } finally {
      setIsLoading(false);
    }
  }, [password, unlockWithPassword]);

  return (
    <div className="rounded-xl border border-zkcoins-border bg-zkcoins-card p-8 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-bitcoin/10">
        <svg
          className="h-8 w-8 text-bitcoin"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
      </div>
      <h2 className="mb-2 text-lg font-semibold text-white">Unlock Wallet</h2>
      {storedAddress && (
        <p className="mb-4 break-all text-xs text-zkcoins-muted">{storedAddress}</p>
      )}

      {storedAuthMethod === 'passkey' ? (
        <button
          onClick={handlePasskeyUnlock}
          disabled={isLoading}
          className="w-64 rounded-lg bg-bitcoin px-6 py-3 font-semibold text-black transition-colors hover:bg-bitcoin-dark disabled:opacity-50"
        >
          {isLoading ? 'Unlocking...' : 'Unlock with Passkey'}
        </button>
      ) : (
        <div className="mx-auto max-w-xs">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePasswordUnlock()}
            placeholder="Enter password"
            className="mb-3 w-full rounded-lg border border-zkcoins-border bg-zkcoins-bg p-3 text-sm text-white placeholder-zkcoins-muted focus:border-bitcoin focus:outline-none"
          />
          <button
            onClick={handlePasswordUnlock}
            disabled={isLoading || !password}
            className="w-full rounded-lg bg-bitcoin px-6 py-3 font-semibold text-black transition-colors hover:bg-bitcoin-dark disabled:opacity-50"
          >
            {isLoading ? 'Unlocking...' : 'Unlock'}
          </button>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <div className="mt-6 border-t border-zkcoins-border pt-4">
        {showDelete ? (
          <div>
            <p className="mb-3 text-sm text-red-400">
              This will permanently delete your wallet. Make sure you have your recovery phrase.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setShowDelete(false)}
                className="rounded-lg border border-zkcoins-border px-4 py-2 text-sm text-zkcoins-muted hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={deleteWallet}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                Delete Wallet
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowDelete(true)}
            className="text-xs text-zkcoins-muted hover:text-red-400"
          >
            Reset wallet
          </button>
        )}
      </div>
    </div>
  );
}
