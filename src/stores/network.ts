import { create } from 'zustand';

export type NetworkId = 'mainnet' | 'testnet';

interface NetworkState {
  activeNetwork: NetworkId;
  networkName: string;
  apiUrl: string;
  setActiveNetwork: (network: NetworkId) => void;
  setNetworkName: (name: string) => void;
}

const MAINNET_API_URL = process.env.NEXT_PUBLIC_MAINNET_API_URL || 'https://api.zkcoins.app';
const TESTNET_API_URL = process.env.NEXT_PUBLIC_TESTNET_API_URL || 'https://dev-api.zkcoins.app';
const DEFAULT_NETWORK = (process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'mainnet') as NetworkId;

function getApiUrl(network: NetworkId): string {
  return network === 'mainnet' ? MAINNET_API_URL : TESTNET_API_URL;
}

function getSavedNetwork(): NetworkId {
  if (typeof window === 'undefined') return DEFAULT_NETWORK;
  return (localStorage.getItem('zkcoins_network') as NetworkId) || DEFAULT_NETWORK;
}

export const useNetworkStore = create<NetworkState>(() => {
  const initial = getSavedNetwork();
  return {
    activeNetwork: initial,
    networkName: '',
    apiUrl: getApiUrl(initial),
    setActiveNetwork: (network) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('zkcoins_network', network);
      }
      useNetworkStore.setState({
        activeNetwork: network,
        apiUrl: getApiUrl(network),
        networkName: '',
      });
    },
    setNetworkName: (name) => {
      useNetworkStore.setState({ networkName: name });
    },
  };
});
