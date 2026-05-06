'use client';

import { useState, useCallback } from 'react';
import {
  createPasskey,
  authenticatePasskey,
  PasskeyPrfUnsupportedError,
} from '@/lib/crypto/passkey';
import { deriveMnemonicFromPrf, DERIVATION_VERSION } from '@/lib/crypto/key-derivation';
import { saveCredential } from '@/lib/crypto/storage';

interface Props {
  onComplete: (mnemonic: string, credentialId: string) => void;
  onBack: () => void;
  mode: 'create' | 'restore';
}

export function PasskeySetup({ onComplete, onBack, mode }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePasskey = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = mode === 'create' ? await createPasskey() : await authenticatePasskey();

      const mnemonic = await deriveMnemonicFromPrf(result.prfOutput);

      await saveCredential({
        credentialId: result.credentialId,
        derivationVersion: DERIVATION_VERSION,
        createdAt: Date.now(),
      });

      onComplete(mnemonic, result.credentialId);
    } catch (err) {
      if (err instanceof PasskeyPrfUnsupportedError) {
        setError(
          'Your device does not support the PRF extension needed for passkey wallets. Please use a seed phrase instead.',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Passkey operation failed');
      }
    } finally {
      setIsLoading(false);
    }
  }, [mode, onComplete]);

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
            d="M12 10v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3a1 1 0 100-2 1 1 0 000 2z"
          />
        </svg>
      </div>
      <h2 className="mb-2 text-lg font-semibold text-white">
        {mode === 'create' ? 'Create with Passkey' : 'Restore with Passkey'}
      </h2>
      <p className="mb-6 text-sm text-zkcoins-muted">
        {mode === 'create'
          ? 'Use Face ID, Touch ID, or your device PIN to create a wallet. Your keys are derived from the passkey — no seed phrase to write down.'
          : 'Authenticate with your existing passkey to restore your wallet.'}
      </p>
      <div className="flex justify-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg border border-zkcoins-border px-5 py-3 text-sm text-zkcoins-muted transition-colors hover:border-white/20 hover:text-white"
        >
          Back
        </button>
        <button
          onClick={handlePasskey}
          disabled={isLoading}
          className="rounded-lg bg-bitcoin px-6 py-3 font-semibold text-black transition-colors hover:bg-bitcoin-dark disabled:opacity-50"
        >
          {isLoading ? 'Authenticating...' : mode === 'create' ? 'Create Passkey' : 'Authenticate'}
        </button>
      </div>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}
