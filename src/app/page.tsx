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
  // `/settings` so both flows wipe the same surfaces: encrypted
  // wallet blob in IndexedDB, passkey credential record, auth-store
  // state. `deleteWallet` clears `hasStoredWallet` + `isLocked` in
  // the wallet store, so the next render falls through to
  // `<Onboarding />` automatically — no reload needed.
  const handleReset = useCallback(async () => {
    await deleteWallet();
    await deleteCredential();
    resetAuth();
  }, [deleteWallet, resetAuth]);

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
        onReset={handleReset}
      />
    );
  }

  return <Onboarding />;
}
