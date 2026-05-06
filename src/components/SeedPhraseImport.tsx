'use client';

import { useState, useCallback } from 'react';
import { initWasm } from '@zkcoins/wasm';

interface Props {
  onComplete: (mnemonic: string) => void;
  onBack: () => void;
}

export function SeedPhraseImport({ onComplete, onBack }: Props) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const handleImport = useCallback(async () => {
    const phrase = input.trim().toLowerCase();
    const words = phrase.split(/\s+/);

    if (words.length !== 12) {
      setError(`Expected 12 words, got ${words.length}.`);
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      const wasm = await initWasm();
      if (!wasm.validateMnemonic(phrase)) {
        setError('Invalid seed phrase. Please check your words.');
        return;
      }
      onComplete(phrase);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  }, [input, onComplete]);

  return (
    <div className="rounded-xl border border-zkcoins-border bg-zkcoins-card p-8">
      <h2 className="mb-2 text-center text-lg font-semibold text-white">Import Wallet</h2>
      <p className="mb-6 text-center text-sm text-zkcoins-muted">
        Enter your 12-word recovery phrase to restore your wallet.
      </p>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Enter your 12 words separated by spaces"
        rows={3}
        className="mb-4 w-full rounded-lg border border-zkcoins-border bg-zkcoins-bg p-3 text-sm text-white placeholder-zkcoins-muted focus:border-bitcoin focus:outline-none"
      />
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      <div className="flex justify-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg border border-zkcoins-border px-5 py-3 text-sm text-zkcoins-muted transition-colors hover:border-white/20 hover:text-white"
        >
          Back
        </button>
        <button
          onClick={handleImport}
          disabled={isValidating || !input.trim()}
          className="rounded-lg bg-bitcoin px-6 py-3 font-semibold text-black transition-colors hover:bg-bitcoin-dark disabled:opacity-50"
        >
          {isValidating ? 'Validating...' : 'Restore Wallet'}
        </button>
      </div>
    </div>
  );
}
