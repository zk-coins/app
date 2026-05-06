'use client';

import { useEffect } from 'react';
import { useNetworkStore } from '@/stores/network';
import { api } from '@/lib/api/client';

export function Header() {
  const { networkName, setNetworkName } = useNetworkStore();

  useEffect(() => {
    api
      .info()
      .then((info) => setNetworkName(info.network))
      .catch(() => {});
  }, [setNetworkName]);

  const isMainnet = networkName.toLowerCase() === 'mainnet';

  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-bitcoin font-bold text-black">
          zk
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">zkCoins</h1>
          <p className="text-xs text-zkcoins-muted">Shielded CSV Wallet</p>
        </div>
      </div>
      {networkName && (
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
              isMainnet
                ? 'bg-green-900/30 text-green-400'
                : 'bg-yellow-900/30 text-yellow-400'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${isMainnet ? 'bg-green-400' : 'bg-yellow-400'}`}
            />
            {networkName}
          </span>
        </div>
      )}
    </header>
  );
}
