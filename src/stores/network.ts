import { create } from 'zustand';

interface NetworkState {
  networkName: string;
  /**
   * Normalised network enum (`'mainnet' | 'mutinynet'`) reported by the
   * node in `/api/info.bitcoin_network` (zk-coins/node#193). Unlike the
   * free-text `networkName` this has stable, lower-case casing, so it is
   * the field protocol-level guards branch on. Empty until the first
   * `/api/info` tick lands, and stays empty when the connected node is
   * pre-#193 and omits the field — consumers must fall back to
   * `networkName` for the mainnet check in that case.
   */
  bitcoinNetwork: string;
  /**
   * External hostname the connected server reports for itself, used to
   * render `<hex|username>@<domain>`. Empty until the first `/api/info`
   * response lands. DEV and PRD live behind different external
   * hostnames (`dev.zkcoins.app` vs. `zkcoins.app`) and the server is
   * the source of truth — we never derive this from the client's
   * `apiUrl` or from `process.env`.
   */
  usernameDomain: string;
  apiUrl: string;
  setNetworkName: (name: string) => void;
  setBitcoinNetwork: (network: string) => void;
  setUsernameDomain: (domain: string) => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.zkcoins.app';

export const useNetworkStore = create<NetworkState>(() => ({
  networkName: '',
  bitcoinNetwork: '',
  usernameDomain: '',
  apiUrl: API_URL,
  setNetworkName: (name) => {
    useNetworkStore.setState({ networkName: name });
  },
  setBitcoinNetwork: (network) => {
    useNetworkStore.setState({ bitcoinNetwork: network });
  },
  setUsernameDomain: (domain) => {
    useNetworkStore.setState({ usernameDomain: domain });
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
