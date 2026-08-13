'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { UnlockScreen } from '@/components/onboarding/UnlockScreen';
import { WalletScreen } from '@/components/screens/WalletScreen';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { useCapabilities } from '@/stores/capabilities';
import { deleteCredential } from '@/lib/crypto/storage';

export default function Home() {
  const {
    account,
    isLocked,
    hasStoredWallet,
    storedAuthMethod,
    needsSeedReimport,
    error,
    checkForStoredWallet,
    unlockWithPassword,
    unlockWithPrf,
    deleteWallet,
  } = useWalletStore();
  const { hydrate, reset: resetAuth } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      await checkForStoredWallet();
      await hydrate();
      // Opt-in server features (address_list, username_claim, lnurl)
      // are reported by GET /v1/info. Fire-and-forget — the store
      // fail-closes on error so an unreachable server hides gated UI
      // rather than crashing the boot path.
      useCapabilities.getState().fetch();
      setHydrated(true);
    })();
  }, [checkForStoredWallet, hydrate]);

  // Escape hatch for users stranded on the unlock screen (forgotten
  // password / passkey gone). Reuses the disconnect chain from
  // `/settings` so both flows wipe the same surfaces. Credential/auth
  // first; wallet flags last — `deleteWallet` clears `hasStoredWallet`
  // + `isLocked`, so the next render falls through to `<Onboarding />`
  // only after durable cleanup has finished. No reload needed.
  const handleReset = useCallback(async () => {
    await deleteCredential();
    resetAuth();
    await deleteWallet();
  }, [deleteWallet, resetAuth]);

  // Confirmed discard of an incompatible legacy store (no encrypted v2 blob).
  // Credential/auth first; wallet flags last so the reimport UI stays mounted
  // until durable cleanup has finished.
  const handleDiscardLegacy = useCallback(async () => {
    await deleteCredential();
    resetAuth();
    await deleteWallet();
  }, [deleteWallet, resetAuth]);

  // checkForStoredWallet clears `error` on successful reads; do not null it
  // before the check or the storage-error surface unmounts into onboarding
  // while the retry is still pending.
  const handleStorageRetry = useCallback(async () => {
    await checkForStoredWallet();
  }, [checkForStoredWallet]);

  if (!hydrated) return null;

  // Unlocked path wins even when `error` is set (e.g. IDB refresh failure
  // while account is already in memory).
  if (account && !isLocked) {
    return (
      <AppShell>
        <WalletScreen />
      </AppShell>
    );
  }

  // Incompatible encrypted or legacy store: reimport wins over unlock and
  // over the storage-error surface. Reimport also sets `error`, but that
  // string is recovery guidance — not an IDB I/O failure.
  // unlockWithPassword/unlockWithPrf set needsSeedReimport while leaving
  // hasStoredWallet+isLocked true — checking unlock first would trap the
  // user on UnlockScreen forever (encrypted xpriv-era path).
  if (needsSeedReimport) {
    return <Onboarding reimportRequired onDiscardLegacy={handleDiscardLegacy} />;
  }

  // IDB read failure with no account: never fall through to Onboarding
  // (that would look like an empty wallet). Gate before unlock/onboarding.
  if (error && !account) {
    return (
      <div
        data-testid="storage-error"
        className="flex min-h-[60vh] flex-col items-center justify-center text-center"
        role="alert"
      >
        <p className="mt-4 max-w-[280px] text-[15px] font-semibold text-ink">{error}</p>
        <button
          type="button"
          data-testid="storage-error-retry"
          onClick={handleStorageRetry}
          className="mt-6 rounded-md bg-bitcoin px-6 py-2.5 text-[13px] font-semibold text-bg transition-colors hover:bg-bitcoin-hover"
        >
          Retry
        </button>
      </div>
    );
  }

  if (hasStoredWallet && isLocked) {
    return (
      <UnlockScreen
        authMethod={storedAuthMethod}
        onUnlockPassword={unlockWithPassword}
        onUnlockPrf={unlockWithPrf}
        onReset={handleReset}
      />
    );
  }

  return <Onboarding />;
}
