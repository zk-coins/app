'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';
import { initWasm } from '@zkcoins/wasm';
import { populateDemoHistory } from '@/lib/simulate';

/**
 * Dev utility: ensures a wallet exists locally, seeds 8 sample transactions
 * with a realistic balance, then redirects to home so the wallet view shows
 * a populated state. Useful for screenshots, demos, and design reviews.
 *
 * Visit /simulate to populate.
 */
export default function SimulatePage() {
  const router = useRouter();
  const { setAccount, setBalance, addTransaction, loadFromStorage } = useWalletStore();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      // Hydrate first.
      loadFromStorage();
      // Wait one tick for store hydration.
      await new Promise((r) => setTimeout(r, 50));

      let acc = useWalletStore.getState().account;
      if (!acc) {
        try {
          const wasm = await initWasm();
          const ad = await wasm.createAccount();
          acc = {
            address: ad.address,
            balance: 0,
            numPubkeys: ad.numPubkeys,
            xpriv: ad.xpriv,
          };
          setAccount(acc);
        } catch {
          // WASM unavailable — create a stub address so the demo still works.
          acc = {
            address: 'zs1sim' + Math.random().toString(16).slice(2, 18) + 'demo',
            balance: 0,
            numPubkeys: 1,
            xpriv: 'sim-demo-xpriv',
          };
          setAccount(acc);
        }
      }

      const { transactions, balance } = populateDemoHistory();
      // Add transactions oldest-first so the wallet store ends up with newest at the front.
      [...transactions].reverse().forEach(addTransaction);
      setBalance(balance);

      router.replace('/');
    })();
  }, [setAccount, setBalance, addTransaction, loadFromStorage, router]);

  return (
    <AppShell showNav={false}>
      <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
        <Loader2 size={28} strokeWidth={1.75} className="animate-spin text-bitcoin" />
        <p className="mt-4 text-[14px] text-ink2">Simulating transactions…</p>
      </div>
    </AppShell>
  );
}
