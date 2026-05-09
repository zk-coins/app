import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '@/stores/auth';

beforeEach(() => {
  useAuthStore.setState({
    authMethod: null,
    credentialId: null,
    isHydrated: false,
  });
  // IndexedDB is reset in setup.ts via fresh IDBFactory per test
});

describe('auth store', () => {
  it('has correct initial state', () => {
    const state = useAuthStore.getState();
    expect(state.authMethod).toBeNull();
    expect(state.credentialId).toBeNull();
    expect(state.isHydrated).toBe(false);
  });

  it('sets auth method to seed', () => {
    useAuthStore.getState().setAuth('seed');
    const state = useAuthStore.getState();
    expect(state.authMethod).toBe('seed');
    expect(state.credentialId).toBeNull();
  });

  it('sets auth method to passkey with credential ID', () => {
    useAuthStore.getState().setAuth('passkey', 'cred-123');
    const state = useAuthStore.getState();
    expect(state.authMethod).toBe('passkey');
    expect(state.credentialId).toBe('cred-123');
  });

  it('resets auth state', () => {
    useAuthStore.getState().setAuth('passkey', 'cred-123');
    useAuthStore.getState().reset();
    const state = useAuthStore.getState();
    expect(state.authMethod).toBeNull();
    expect(state.credentialId).toBeNull();
  });

  it('hydrate sets isHydrated when no credential stored', async () => {
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().isHydrated).toBe(true);
    expect(useAuthStore.getState().authMethod).toBeNull();
  });

  it('hydrate loads passkey credential from IndexedDB', async () => {
    // Save a credential first
    const { saveCredential } = await import('@/lib/crypto/storage');
    await saveCredential({
      credentialId: 'stored-cred-456',
      derivationVersion: 'v1',
      createdAt: Date.now(),
    });

    await useAuthStore.getState().hydrate();
    const state = useAuthStore.getState();
    expect(state.isHydrated).toBe(true);
    expect(state.authMethod).toBe('passkey');
    expect(state.credentialId).toBe('stored-cred-456');
  });
});
