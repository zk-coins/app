'use client';

import { useCallback, useState } from 'react';
import { Logo } from '../icons/Logo';
import { PixelIcon } from '../PixelIcon';
import { useAuthStore } from '@/stores/auth';
import { authenticatePasskey } from '@/lib/crypto/passkey';
import { FEATURES } from '@/lib/features';

/**
 * Unlock screen — rendered by `Home` when an encrypted wallet is in
 * IndexedDB but no in-memory account exists yet.
 *
 * Extracted from `src/app/page.tsx` so it can be unit-tested in
 * isolation (issue #68 W1). The prop bag is the natural boundary —
 * the screen knows nothing about Zustand.
 */
export function UnlockScreen({
  authMethod,
  onUnlockPassword,
  onUnlockPrf,
}: {
  authMethod: 'passkey' | 'seed' | null;
  onUnlockPassword: (password: string) => Promise<void>;
  onUnlockPrf: (prfOutput: Uint8Array) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const credentialId = useAuthStore((s) => s.credentialId);

  const handlePasswordUnlock = useCallback(async () => {
    if (unlocking || !password) return;
    setUnlocking(true);
    setError(null);
    try {
      await onUnlockPassword(password);
    } catch {
      setError('Incorrect password');
    } finally {
      setUnlocking(false);
    }
  }, [password, unlocking, onUnlockPassword]);

  const handlePasskeyUnlock = useCallback(async () => {
    if (unlocking) return;
    setUnlocking(true);
    setError(null);
    try {
      const result = await authenticatePasskey(credentialId ?? undefined);
      await onUnlockPrf(result.prfOutput);
    } catch (err) {
      const cancelled =
        err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError');
      setError(cancelled ? 'Authentication cancelled.' : 'Failed to unlock wallet');
    } finally {
      setUnlocking(false);
    }
  }, [credentialId, unlocking, onUnlockPrf]);

  return (
    <div className="relative min-h-screen bg-bg">
      <div className="mx-auto max-w-[480px] px-6 py-20 md:py-32">
        <div className="flex flex-col items-center text-center">
          <Logo size={48} />
          <h1
            data-testid="unlock-heading"
            className="mt-6 text-[24px] font-bold tracking-tight text-ink"
          >
            Welcome back
          </h1>
          <p className="mt-2 text-[13px] text-ink2">Unlock your wallet to continue</p>
        </div>

        {FEATURES.PASSKEY && authMethod === 'passkey' ? (
          <div className="mt-10 space-y-4">
            <button
              type="button"
              data-testid="unlock-passkey-btn"
              onClick={handlePasskeyUnlock}
              disabled={unlocking}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-bitcoin py-4 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:bg-line disabled:text-ink4"
            >
              <PixelIcon name="key" size={14} />
              {unlocking ? 'Authenticating…' : 'Unlock with passkey'}
            </button>
            {error && (
              <p data-testid="unlock-error" className="text-center text-[12px] text-bad">
                {error}
              </p>
            )}
          </div>
        ) : (
          <form
            className="mt-10 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              handlePasswordUnlock();
            }}
          >
            <input
              data-testid="unlock-password-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full rounded-md border border-line2 bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
            />
            <button
              type="submit"
              data-testid="unlock-submit-btn"
              data-unlocking={unlocking || undefined}
              disabled={unlocking || !password}
              className="w-full rounded-md bg-bitcoin py-4 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
            >
              {unlocking ? 'Unlocking…' : 'Unlock'}
            </button>
            {error && (
              <p data-testid="unlock-error" className="text-center text-[12px] text-bad">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
