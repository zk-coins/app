'use client';

import { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/AppShell';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { WalletScreen } from '@/components/screens/WalletScreen';
import { Logo } from '@/components/icons/Logo';
import { PixelIcon } from '@/components/PixelIcon';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { authenticatePasskey } from '@/lib/crypto/passkey';

export default function Home() {
  const {
    account,
    isLocked,
    hasStoredWallet,
    storedAuthMethod,
    checkForStoredWallet,
    unlockWithPassword,
    unlockWithPrf,
  } = useWalletStore();
  const { hydrate } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      await checkForStoredWallet();
      await hydrate();
      setHydrated(true);
    })();
  }, [checkForStoredWallet, hydrate]);

  if (!hydrated) return null;

  if (account && !isLocked) {
    return (
      <AppShell>
        <WalletScreen />
      </AppShell>
    );
  }

  if (hasStoredWallet && isLocked) {
    return (
      <UnlockScreen
        authMethod={storedAuthMethod}
        onUnlockPassword={unlockWithPassword}
        onUnlockPrf={unlockWithPrf}
      />
    );
  }

  return <Onboarding />;
}

function UnlockScreen({
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

  return (
    <div className="relative min-h-screen bg-bg">
      <div className="mx-auto max-w-[480px] px-6 py-20 md:py-32">
        <div className="flex flex-col items-center text-center">
          <Logo size={48} />
          <h1 className="mt-6 text-[24px] font-bold tracking-tight text-ink">Welcome back</h1>
          <p className="mt-2 text-[13px] text-ink2">Unlock your wallet to continue</p>
        </div>

        <div className="mt-10 space-y-4">
          {authMethod === 'passkey' ? (
            <button
              onClick={handlePasskeyUnlock}
              disabled={unlocking}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-bitcoin py-4 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:bg-line disabled:text-ink4"
            >
              <PixelIcon name="key" size={14} />
              {unlocking ? 'Authenticating…' : 'Unlock with passkey'}
            </button>
          ) : (
            <>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePasswordUnlock()}
                placeholder="Enter your password"
                className="w-full rounded-md border border-line2 bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
              />
              <button
                onClick={handlePasswordUnlock}
                disabled={unlocking || !password}
                className="w-full rounded-md bg-bitcoin py-4 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
              >
                {unlocking ? 'Unlocking…' : 'Unlock'}
              </button>
            </>
          )}

          {error && <p className="text-center text-[12px] text-bad">{error}</p>}
        </div>
      </div>
    </div>
  );
}
