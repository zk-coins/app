import { describe, it, expect } from 'vitest';
import {
  saveCredential,
  loadCredential,
  deleteCredential,
  saveEncryptedWallet,
  loadEncryptedWallet,
  deleteEncryptedWallet,
  clearLegacyStorage,
} from '@/lib/crypto/storage';
import type { StoredCredential, StoredWallet } from '@/lib/crypto/storage';

// IndexedDB is reset in setup.ts via fresh IDBFactory per test

const testCredential: StoredCredential = {
  credentialId: 'test-credential-id-base64url',
  derivationVersion: 'v1',
  createdAt: 1700000000000,
};

const testWallet: StoredWallet = {
  encrypted: {
    ciphertext: 'Y2lwaGVydGV4dA==',
    iv: 'aXY=',
    salt: 'c2FsdA==',
  },
  authMethod: 'seed',
  address: 'a'.repeat(64),
  createdAt: 1700000000000,
};

describe('credential storage', () => {
  it('saves and loads a credential', async () => {
    await saveCredential(testCredential);
    const loaded = await loadCredential();
    expect(loaded).toEqual(testCredential);
  });

  it('returns null when no credential stored', async () => {
    const loaded = await loadCredential();
    expect(loaded).toBeNull();
  });

  it('overwrites existing credential', async () => {
    await saveCredential(testCredential);
    const updated = { ...testCredential, credentialId: 'updated-id' };
    await saveCredential(updated);
    const loaded = await loadCredential();
    expect(loaded?.credentialId).toBe('updated-id');
  });

  it('deletes a credential', async () => {
    await saveCredential(testCredential);
    await deleteCredential();
    const loaded = await loadCredential();
    expect(loaded).toBeNull();
  });

  it('delete on empty store does not throw', async () => {
    await expect(deleteCredential()).resolves.not.toThrow();
  });
});

describe('encrypted wallet storage', () => {
  it('saves and loads wallet data', async () => {
    await saveEncryptedWallet(testWallet);
    const loaded = await loadEncryptedWallet();
    expect(loaded).toEqual(testWallet);
  });

  it('returns null when no wallet stored', async () => {
    const loaded = await loadEncryptedWallet();
    expect(loaded).toBeNull();
  });

  it('preserves authMethod passkey', async () => {
    const passkeyWallet: StoredWallet = { ...testWallet, authMethod: 'passkey' };
    await saveEncryptedWallet(passkeyWallet);
    const loaded = await loadEncryptedWallet();
    expect(loaded?.authMethod).toBe('passkey');
  });

  it('preserves address for display while locked', async () => {
    await saveEncryptedWallet(testWallet);
    const loaded = await loadEncryptedWallet();
    expect(loaded?.address).toBe('a'.repeat(64));
  });

  it('overwrites existing wallet', async () => {
    await saveEncryptedWallet(testWallet);
    const updated = { ...testWallet, address: 'b'.repeat(64) };
    await saveEncryptedWallet(updated);
    const loaded = await loadEncryptedWallet();
    expect(loaded?.address).toBe('b'.repeat(64));
  });

  it('deletes wallet data', async () => {
    await saveEncryptedWallet(testWallet);
    await deleteEncryptedWallet();
    const loaded = await loadEncryptedWallet();
    expect(loaded).toBeNull();
  });

  it('delete on empty store does not throw', async () => {
    await expect(deleteEncryptedWallet()).resolves.not.toThrow();
  });

  it('credential and wallet are independent stores', async () => {
    await saveCredential(testCredential);
    await saveEncryptedWallet(testWallet);
    await deleteCredential();
    const wallet = await loadEncryptedWallet();
    expect(wallet).toEqual(testWallet);
  });
});

describe('clearLegacyStorage', () => {
  it('removes zkcoins_wallet from localStorage', () => {
    localStorage.setItem('zkcoins_wallet', '{"test":true}');
    localStorage.setItem('zkcoins_auth', '{"method":"seed"}');
    clearLegacyStorage();
    expect(localStorage.getItem('zkcoins_wallet')).toBeNull();
    expect(localStorage.getItem('zkcoins_auth')).toBeNull();
  });

  it('does not remove unrelated localStorage items', () => {
    localStorage.setItem('other_key', 'value');
    clearLegacyStorage();
    expect(localStorage.getItem('other_key')).toBe('value');
  });
});
