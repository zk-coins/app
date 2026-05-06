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
