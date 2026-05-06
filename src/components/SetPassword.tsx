'use client';

import { useState, useCallback } from 'react';

interface Props {
  onComplete: (password: string) => void;
}

export function SetPassword({ onComplete }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(() => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    onComplete(password);
  }, [password, confirm, onComplete]);

  return (
    <div className="rounded-xl border border-zkcoins-border bg-zkcoins-card p-8">
      <h2 className="mb-2 text-center text-lg font-semibold text-white">Set Unlock Password</h2>
      <p className="mb-6 text-center text-sm text-zkcoins-muted">
        Choose a password to encrypt your wallet. You will need it to unlock the wallet each time
        you return.
      </p>
      <div className="mx-auto max-w-xs space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min. 8 characters)"
          className="w-full rounded-lg border border-zkcoins-border bg-zkcoins-bg p-3 text-sm text-white placeholder-zkcoins-muted focus:border-bitcoin focus:outline-none"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Confirm password"
          className="w-full rounded-lg border border-zkcoins-border bg-zkcoins-bg p-3 text-sm text-white placeholder-zkcoins-muted focus:border-bitcoin focus:outline-none"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          onClick={handleSubmit}
          disabled={!password || !confirm}
          className="w-full rounded-lg bg-bitcoin px-6 py-3 font-semibold text-black transition-colors hover:bg-bitcoin-dark disabled:opacity-50"
        >
          Encrypt & Save
        </button>
      </div>
    </div>
  );
}
