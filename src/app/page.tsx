'use client';

import { useEffect } from 'react';
import { AppShell } from '@/components/AppShell';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { WalletScreen } from '@/components/screens/WalletScreen';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';

export default function Home() {
  const { account, loadFromStorage } = useWalletStore();
  const activeNetwork = useNetworkStore((s) => s.activeNetwork);

  useEffect(() => {
    loadFromStorage();
  }, [activeNetwork, loadFromStorage]);

  if (!account) {
    return <Onboarding />;
  }

  return (
    <AppShell>
      <WalletScreen />
    </AppShell>
  );
}
