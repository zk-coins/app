import { describe, it, expect, beforeEach } from 'vitest';
import { isV1Network, useNetworkStore } from '@/stores/network';

beforeEach(() => {
  useNetworkStore.setState({
    network: '',
    usernameDomain: '',
    features: [],
    infoError: null,
    infoLoaded: false,
    apiUrl: 'https://api.zkcoins.app',
  });
});

describe('isV1Network', () => {
  it('accepts the closed set', () => {
    expect(isV1Network('mainnet')).toBe(true);
    expect(isV1Network('testnet')).toBe(true);
    expect(isV1Network('regtest')).toBe(true);
  });

  it('rejects legacy and unknown tags', () => {
    expect(isV1Network('mutinynet')).toBe(false);
    expect(isV1Network('Mutinynet')).toBe(false);
    expect(isV1Network('')).toBe(false);
    expect(isV1Network(undefined)).toBe(false);
  });
});

describe('network store', () => {
  it('has correct initial state', () => {
    const state = useNetworkStore.getState();
    expect(state.network).toBe('');
    expect(state.infoError).toBeNull();
    expect(state.infoLoaded).toBe(false);
    expect(state.apiUrl).toBe('https://api.zkcoins.app');
  });

  it('applyInfo sets a valid network and clears errors', () => {
    useNetworkStore.getState().applyInfo({
      network: 'testnet',
      features: ['wallet'],
      username_domain: 'example.com',
    });
    const s = useNetworkStore.getState();
    expect(s.network).toBe('testnet');
    expect(s.features).toEqual(['wallet']);
    expect(s.usernameDomain).toBe('example.com');
    expect(s.infoError).toBeNull();
    expect(s.infoLoaded).toBe(true);
  });

  it('applyInfo refuses mutinynet without silent coercion', () => {
    useNetworkStore.getState().applyInfo({ network: 'mutinynet' });
    const s = useNetworkStore.getState();
    expect(s.network).toBe('');
    expect(s.infoError).toMatch(/unsupported network/);
    expect(s.infoLoaded).toBe(true);
  });

  it('applyInfoFailure records a visible error and clears network', () => {
    useNetworkStore.getState().setNetwork('regtest');
    useNetworkStore.getState().applyInfoFailure('network down');
    const s = useNetworkStore.getState();
    expect(s.network).toBe('');
    expect(s.infoError).toBe('network down');
    expect(s.infoLoaded).toBe(true);
  });

  it('setters update usernameDomain, features, infoError, and infoLoaded', () => {
    const store = useNetworkStore.getState();
    store.setUsernameDomain('names.example');
    store.setFeatures(['wallet', 'explorer']);
    store.setInfoError('stale');
    store.setInfoLoaded(true);
    const s = useNetworkStore.getState();
    expect(s.usernameDomain).toBe('names.example');
    expect(s.features).toEqual(['wallet', 'explorer']);
    // setFeatures copies — mutating the input must not alias store state
    const input = ['wallet'];
    store.setFeatures(input);
    input.push('mutated');
    expect(useNetworkStore.getState().features).toEqual(['wallet']);
    expect(s.infoError).toBe('stale');
    expect(s.infoLoaded).toBe(true);
  });

  it('applyInfo clears usernameDomain when the field is omitted', () => {
    useNetworkStore.getState().setUsernameDomain('old.example');
    useNetworkStore.getState().applyInfo({ network: 'mainnet' });
    const s = useNetworkStore.getState();
    expect(s.network).toBe('mainnet');
    expect(s.usernameDomain).toBe('');
    expect(s.features).toEqual([]);
  });
});
