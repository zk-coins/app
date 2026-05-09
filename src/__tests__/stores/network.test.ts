import { describe, it, expect, beforeEach } from 'vitest';
import { useNetworkStore } from '@/stores/network';

beforeEach(() => {
  useNetworkStore.setState({
    networkName: '',
    apiUrl: 'https://api.zkcoins.app',
  });
});

describe('network store', () => {
  it('has correct initial state', () => {
    const state = useNetworkStore.getState();
    expect(state.networkName).toBe('');
    expect(state.apiUrl).toBe('https://api.zkcoins.app');
  });

  it('sets network name', () => {
    useNetworkStore.getState().setNetworkName('Mainnet');
    expect(useNetworkStore.getState().networkName).toBe('Mainnet');
  });

  it('updates network name to Mutinynet', () => {
    useNetworkStore.getState().setNetworkName('Mutinynet');
    expect(useNetworkStore.getState().networkName).toBe('Mutinynet');
  });

  it('can clear network name', () => {
    useNetworkStore.getState().setNetworkName('Mainnet');
    useNetworkStore.getState().setNetworkName('');
    expect(useNetworkStore.getState().networkName).toBe('');
  });
});
