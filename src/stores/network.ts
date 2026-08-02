import { create } from 'zustand';
import type { Network } from '@zkcoins/sdk';

export type { Network };

/** Closed v1 network tags from `GET /v1/info` (§7.5). */
export const V1_NETWORKS = ['mainnet', 'testnet', 'regtest'] as const;

export function isV1Network(value: unknown): value is Network {
  return value === 'mainnet' || value === 'testnet' || value === 'regtest';
}

interface NetworkState {
  /**
   * Network tag from `GET /v1/info.network` ∈ {mainnet|testnet|regtest}.
   * Empty until the first successful info fetch. There is no separate
   * `bitcoin_network` field in v1 — the tag is 1:1 with the Bitcoin network.
   */
  network: Network | '';
  /**
   * Optional display hostname for name-style receive labels (operator
   * policy). Empty when the node does not advertise one. Never derived
   * from `apiUrl` — the server is the source of truth when present.
   */
  usernameDomain: string;
  /**
   * Closed `features` advertisement from `GET /v1/info` (§6.1 / §7.5).
   * Elements ∈ {wallet, explorer, publisher, lightning_bridge, mail_bridge}.
   */
  features: string[];
  /**
   * Last error loading `/v1/info`. Non-null means the app must not assume
   * a network — no silent fallback to a local guess.
   */
  infoError: string | null;
  /** True after the first info attempt settles (success or failure). */
  infoLoaded: boolean;
  apiUrl: string;
  setNetwork: (network: Network | '') => void;
  setUsernameDomain: (domain: string) => void;
  setFeatures: (features: string[]) => void;
  setInfoError: (error: string | null) => void;
  setInfoLoaded: (loaded: boolean) => void;
  /**
   * Apply a successful `GET /v1/info` payload. Clears `infoError`.
   * Rejects unknown network tags (no silent coercion).
   */
  applyInfo: (info: { network: string; features?: string[]; username_domain?: string }) => void;
  /** Record a failed info load as a visible error state. */
  applyInfoFailure: (message: string) => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.zkcoins.app';

export const useNetworkStore = create<NetworkState>(() => ({
  network: '',
  usernameDomain: '',
  features: [],
  infoError: null,
  infoLoaded: false,
  apiUrl: API_URL,
  setNetwork: (network) => {
    useNetworkStore.setState({ network });
  },
  setUsernameDomain: (domain) => {
    useNetworkStore.setState({ usernameDomain: domain });
  },
  setFeatures: (features) => {
    useNetworkStore.setState({ features: [...features] });
  },
  setInfoError: (error) => {
    useNetworkStore.setState({ infoError: error });
  },
  setInfoLoaded: (loaded) => {
    useNetworkStore.setState({ infoLoaded: loaded });
  },
  applyInfo: (info) => {
    if (!isV1Network(info.network)) {
      useNetworkStore.setState({
        network: '',
        infoError: `unsupported network tag from node: ${JSON.stringify(info.network)}`,
        infoLoaded: true,
      });
      return;
    }
    useNetworkStore.setState({
      network: info.network,
      features: Array.isArray(info.features) ? [...info.features] : [],
      usernameDomain: typeof info.username_domain === 'string' ? info.username_domain : '',
      infoError: null,
      infoLoaded: true,
    });
  },
  applyInfoFailure: (message) => {
    useNetworkStore.setState({
      network: '',
      infoError: message,
      infoLoaded: true,
    });
  },
}));

// Expose the store on `window.__useNetworkStore` so e2e specs can
// poke network state for loading-state baselines. Read-only consumers
// (the live app) can ignore this; nothing in production code paths
// touches the global. See `e2e/09-network-and-shell.spec.ts`.
/* c8 ignore next 3 — SSR guard, unreachable in the browser test env */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__useNetworkStore = useNetworkStore;
}
