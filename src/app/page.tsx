'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { UnlockScreen } from '@/components/onboarding/UnlockScreen';
import { WalletScreen } from '@/components/screens/WalletScreen';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';

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
