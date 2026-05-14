'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { notFound } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';
import { initWasm } from '@zkcoins/wasm';
import { populateDemoHistory } from '@/lib/simulate';
import { FEATURES } from '@/lib/features';

/**
 * Dev utility: ensures a wallet exists locally, seeds 8 sample transactions
 * with a realistic balance, then redirects to home so the wallet view shows
 * a populated state. Useful for screenshots, demos, and design reviews.
 *
 * Visit /simulate to populate.
 *
 * Gated by `NEXT_PUBLIC_ENABLE_DEV_ROUTES`. When the flag is statically
 * `false` at build time, `notFound()` short-circuits before any wallet or
 * WASM code executes — the gated code path cannot run, regardless of how
 * the route is reached.
 */
export default function SimulatePage() {
  if (!FEATURES.DEV_ROUTES) notFound();

  const router = useRouter();
  const { account, setAccount, setBalance, addTransaction } = useWalletStore();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      let acc = account;
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
          // WASM unavailable — cannot create demo wallet without it.
          router.replace('/');
          return;
        }
      }

      const { transactions, balance } = populateDemoHistory();
      [...transactions].reverse().forEach(addTransaction);
      setBalance(balance);

      router.replace('/');
    })();
  }, [account, setAccount, setBalance, addTransaction, router]);

  return (
    <AppShell showNav={false}>
      <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
        <Loader2 size={28} strokeWidth={1.75} className="animate-spin text-bitcoin" />
        <p className="mt-4 text-[14px] text-ink2">Simulating transactions…</p>
      </div>
    </AppShell>
  );
}
