'use client';

import { useCallback, useState } from 'react';
import { Logo } from '../icons/Logo';
import { PixelIcon } from '../PixelIcon';
import { useAuthStore } from '@/stores/auth';
import { authenticatePasskey } from '@/lib/crypto/passkey';
import { FEATURES } from '@/lib/features';

/**
 * Confirm copy shown before wiping the local encrypted wallet. The
 * unlock screen is the only place a user with a forgotten password
 * can escape — make sure they understand the device-local nature of
 * the wipe and the seed-phrase requirement to restore.
 *
 * @internal Exported for the component test. Do not import from app code.
 */
export const UNLOCK_RESET_CONFIRM =
  "Reset wallet? This deletes the encrypted wallet on this device. You'll need your 12-word seed phrase to restore it. This cannot be undone.";

/**
 * Surface message when `onReset` throws. The caller's reset chain
 * (deleteWallet → deleteCredential → resetAuth) is mostly idempotent,
 * but a partial failure can leave IDB in a half-wiped state — telling
 * the user to reload is the safest recovery path.
 *
 * @internal Exported for the component test. Do not import from app code.
 */
export const UNLOCK_RESET_ERROR = 'Reset failed. Reload the page and try again.';

/**
 * Unlock screen — rendered by `Home` when an encrypted wallet is in
 * IndexedDB but no in-memory account exists yet.
 *
 * Extracted from `src/app/page.tsx` so it can be unit-tested in
 * isolation (issue #68 W1). The prop bag is the natural boundary —
 * the screen knows nothing about Zustand.
 *
 * `onReset` is the escape hatch for users who forgot their password
 * (or whose passkey is no longer available). It wipes the encrypted
 * wallet + credential on this device so `Home` can fall back to the
 * Onboarding flow on the next render. The caller (Home) owns the
 * actual delete chain — this component only triggers it after an
 * explicit user confirmation.
 */
export function UnlockScreen({
  authMethod,
  onUnlockPassword,
  onUnlockPrf,
  onReset,
}: {
  authMethod: 'passkey' | 'seed' | null;
  onUnlockPassword: (password: string) => Promise<void>;
  onUnlockPrf: (prfOutput: Uint8Array) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const credentialId = useAuthStore((s) => s.credentialId);

  const handlePasswordUnlock = useCallback(async () => {
    if (!password) return;
    setUnlocking(true);
    setError(null);
    try {
      await onUnlockPassword(password);
    } catch {
      setError('Incorrect password');
    } finally {
      setUnlocking(false);
    }
  }, [password, onUnlockPassword]);

  const handlePasskeyUnlock = useCallback(async () => {
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
  }, [credentialId, onUnlockPrf]);

  const handleReset = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm(UNLOCK_RESET_CONFIRM)) {
      // User backed out — clear any previous "Incorrect password" /
      // "Reset failed" banner so the screen is back to its idle state.
      setError(null);
      return;
    }
    setResetting(true);
    setError(null);
    try {
      await onReset();
    } catch {
      // Don't surface the underlying error class — the user can't act
      // on it. The IDB delete chain is mostly idempotent, so a reload
      // usually completes the wipe and lands them in Onboarding.
      setError(UNLOCK_RESET_ERROR);
    } finally {
      setResetting(false);
    }
  }, [onReset]);

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
              data-testid="unlock-passkey-btn"
              onClick={handlePasskeyUnlock}
              disabled={unlocking || resetting}
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
            <ResetLink onClick={handleReset} disabled={unlocking || resetting} busy={resetting} />
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
              disabled={unlocking || resetting || !password}
              className="w-full rounded-md bg-bitcoin py-4 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
            >
              {unlocking ? 'Unlocking…' : 'Unlock'}
            </button>
            {error && (
              <p data-testid="unlock-error" className="text-center text-[12px] text-bad">
                {error}
              </p>
            )}
            <ResetLink onClick={handleReset} disabled={unlocking || resetting} busy={resetting} />
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Secondary, low-emphasis affordance — by design NOT a second primary
 * button. Unlock remains the primary action; reset is the escape
 * hatch for users who can't unlock (forgotten password / passkey
 * gone). Rendered as a plain text button so the visual hierarchy
 * keeps users on the unlock path unless they deliberately deviate.
 */
function ResetLink({
  onClick,
  disabled,
  busy,
}: {
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  return (
    <div className="pt-2 text-center">
      <button
        type="button"
        data-testid="unlock-reset-btn"
        onClick={onClick}
        disabled={disabled}
        aria-busy={busy}
        className="text-[12px] text-ink3 underline-offset-2 transition-colors hover:text-bitcoin hover:underline disabled:cursor-not-allowed disabled:text-ink4 disabled:no-underline"
      >
        {busy ? 'Resetting…' : 'Forgot password? Reset wallet'}
      </button>
    </div>
  );
}
