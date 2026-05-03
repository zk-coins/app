'use client';

import { useEffect } from 'react';
import { useNetworkStore, type NetworkId } from '@/stores/network';
import { api } from '@/lib/api/client';

export function Header() {
  const { activeNetwork, networkName, setActiveNetwork, setNetworkName } = useNetworkStore();

  useEffect(() => {
    api
      .info()
      .then((info) => setNetworkName(info.network))
      .catch(() => {});
  }, [activeNetwork, setNetworkName]);

  const toggleNetwork = () => {
    const next: NetworkId = activeNetwork === 'mainnet' ? 'testnet' : 'mainnet';
    setActiveNetwork(next);
  };

  const isMainnet = activeNetwork === 'mainnet';

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
      <div className="flex items-center gap-2">
        <button
          onClick={toggleNetwork}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors ${
            isMainnet
              ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
              : 'bg-yellow-900/30 text-yellow-400 hover:bg-yellow-900/50'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${isMainnet ? 'bg-green-400' : 'bg-yellow-400'}`}
          />
          {networkName || (isMainnet ? 'Mainnet' : 'Testnet')}
        </button>
      </div>
    </header>
  );
}
