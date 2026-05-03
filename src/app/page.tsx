'use client';

import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { WalletCard } from '@/components/WalletCard';
import { SendForm } from '@/components/SendForm';
import { TransactionLog } from '@/components/TransactionLog';
import { useWalletStore } from '@/stores/wallet';

export default function Home() {
  const { account, isLoading } = useWalletStore();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Header />
      <div className="mt-8 space-y-6">
        <WalletCard />
        {account && !isLoading && (
          <>
            <SendForm />
            <TransactionLog />
          </>
        )}
      </div>
      <Footer />
    </main>
  );
}
