'use client';

import { useState, useCallback } from 'react';
import { initWasm } from '@zkcoins/wasm';

interface Props {
  onComplete: (mnemonic: string) => void;
  onBack: () => void;
}

type Step = 'generate' | 'confirm';

export function SeedPhraseSetup({ onComplete, onBack }: Props) {
  const [step, setStep] = useState<Step>('generate');
  const [mnemonic, setMnemonic] = useState<string>('');
  const [confirmInput, setConfirmInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const wasm = await initWasm();
      const phrase = wasm.generateMnemonic();
      setMnemonic(phrase);
      setStep('generate');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate mnemonic');
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const handleConfirm = useCallback(() => {
    if (confirmInput.trim().toLowerCase() !== mnemonic.toLowerCase()) {
      setError('Seed phrase does not match. Please try again.');
      return;
    }
    setError(null);
    onComplete(mnemonic);
  }, [confirmInput, mnemonic, onComplete]);

  if (!mnemonic) {
    return (
      <div className="rounded-xl border border-zkcoins-border bg-zkcoins-card p-8 text-center">
        <h2 className="mb-2 text-lg font-semibold text-white">Seed Phrase</h2>
        <p className="mb-6 text-sm text-zkcoins-muted">
          Generate a 12-word recovery phrase. Write it down and store it safely — it is the only way
          to recover your wallet.
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={onBack}
            className="rounded-lg border border-zkcoins-border px-5 py-3 text-sm text-zkcoins-muted transition-colors hover:border-white/20 hover:text-white"
          >
            Back
          </button>
          <button
            onClick={generate}
            disabled={isGenerating}
            className="rounded-lg bg-bitcoin px-6 py-3 font-semibold text-black transition-colors hover:bg-bitcoin-dark disabled:opacity-50"
          >
            {isGenerating ? 'Generating...' : 'Generate'}
          </button>
        </div>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  if (step === 'generate') {
    const words = mnemonic.split(' ');
    return (
      <div className="rounded-xl border border-zkcoins-border bg-zkcoins-card p-8">
        <h2 className="mb-2 text-center text-lg font-semibold text-white">Your Recovery Phrase</h2>
        <p className="mb-6 text-center text-sm text-zkcoins-muted">
          Write down these 12 words in order. Do not share them with anyone.
        </p>
        <div className="mx-auto mb-6 grid max-w-md grid-cols-3 gap-2">
          {words.map((word, i) => (
            <div key={i} className="rounded-lg bg-zkcoins-bg px-3 py-2 text-center text-sm">
              <span className="text-zkcoins-muted">{i + 1}.</span>{' '}
              <span className="text-white">{word}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-3">
          <button
            onClick={onBack}
            className="rounded-lg border border-zkcoins-border px-5 py-3 text-sm text-zkcoins-muted transition-colors hover:border-white/20 hover:text-white"
          >
            Back
          </button>
          <button
            onClick={() => {
              setStep('confirm');
              setConfirmInput('');
              setError(null);
            }}
            className="rounded-lg bg-bitcoin px-6 py-3 font-semibold text-black transition-colors hover:bg-bitcoin-dark"
          >
            I wrote it down
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zkcoins-border bg-zkcoins-card p-8">
      <h2 className="mb-2 text-center text-lg font-semibold text-white">Confirm Recovery Phrase</h2>
      <p className="mb-6 text-center text-sm text-zkcoins-muted">
        Enter your 12 words to confirm you saved them correctly.
      </p>
      <textarea
        value={confirmInput}
        onChange={(e) => setConfirmInput(e.target.value)}
        placeholder="Enter your 12 words separated by spaces"
        rows={3}
        className="mb-4 w-full rounded-lg border border-zkcoins-border bg-zkcoins-bg p-3 text-sm text-white placeholder-zkcoins-muted focus:border-bitcoin focus:outline-none"
      />
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      <div className="flex justify-center gap-3">
        <button
          onClick={() => {
            setStep('generate');
            setError(null);
          }}
          className="rounded-lg border border-zkcoins-border px-5 py-3 text-sm text-zkcoins-muted transition-colors hover:border-white/20 hover:text-white"
        >
          Show again
        </button>
        <button
          onClick={handleConfirm}
          className="rounded-lg bg-bitcoin px-6 py-3 font-semibold text-black transition-colors hover:bg-bitcoin-dark"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
