import { create } from 'zustand';

interface NetworkState {
  networkName: string;
  apiUrl: string;
  setNetworkName: (name: string) => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.zkcoins.app';

export const useNetworkStore = create<NetworkState>(() => ({
  networkName: '',
  apiUrl: API_URL,
  setNetworkName: (name) => {
    useNetworkStore.setState({ networkName: name });
  },
}));

// Expose the store on `window.__useNetworkStore` so e2e specs can
// poke `networkName` for loading-state baselines. Read-only consumers
// (the live app) can ignore this; nothing in production code paths
// touches the global. See `e2e/09-network-and-shell.spec.ts`.
/* c8 ignore next 3 — SSR guard, unreachable in the browser test env */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__useNetworkStore = useNetworkStore;
}
