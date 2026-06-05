import { describe, it, expect, beforeEach } from 'vitest';
import { useNetworkStore } from '@/stores/network';

beforeEach(() => {
  useNetworkStore.setState({
    networkName: '',
    bitcoinNetwork: '',
    apiUrl: 'https://api.zkcoins.app',
  });
});

describe('network store', () => {
  it('has correct initial state', () => {
    const state = useNetworkStore.getState();
    expect(state.networkName).toBe('');
    expect(state.bitcoinNetwork).toBe('');
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

  it('sets the normalised bitcoin_network enum', () => {
    useNetworkStore.getState().setBitcoinNetwork('mainnet');
    expect(useNetworkStore.getState().bitcoinNetwork).toBe('mainnet');
  });

  it('updates bitcoin_network to mutinynet', () => {
    useNetworkStore.getState().setBitcoinNetwork('mutinynet');
    expect(useNetworkStore.getState().bitcoinNetwork).toBe('mutinynet');
  });

  it('can clear bitcoin_network (pre-#193 node omits the field)', () => {
    useNetworkStore.getState().setBitcoinNetwork('mainnet');
    useNetworkStore.getState().setBitcoinNetwork('');
    expect(useNetworkStore.getState().bitcoinNetwork).toBe('');
  });
});
