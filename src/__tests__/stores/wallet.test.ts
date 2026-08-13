import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useWalletStore,
  parseWalletPayload,
  IncompatibleWalletError,
  WALLET_PAYLOAD_VERSION,
} from '@/stores/wallet';
import type { Account } from '@/stores/wallet';

const testAccount: Account = {
  address: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};

beforeEach(() => {
  useWalletStore.setState({
    account: null,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    error: null,
    needsSeedReimport: false,
  });
  localStorage.clear();
});

describe('wallet store — basic state', () => {
  it('has correct initial state', () => {
    const state = useWalletStore.getState();
    expect(state.account).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.isLocked).toBe(false);
    expect(state.hasStoredWallet).toBe(false);
    expect(state.error).toBeNull();
    expect(state.needsSeedReimport).toBe(false);
  });

  it('sets account', () => {
    useWalletStore.getState().setAccount(testAccount);
    expect(useWalletStore.getState().account).toEqual(testAccount);
  });

  it('clears account with null', () => {
    useWalletStore.getState().setAccount(testAccount);
    useWalletStore.getState().setAccount(null);
    expect(useWalletStore.getState().account).toBeNull();
  });

  it('sets loading state', () => {
    useWalletStore.getState().setLoading(true);
    expect(useWalletStore.getState().isLoading).toBe(true);
    useWalletStore.getState().setLoading(false);
    expect(useWalletStore.getState().isLoading).toBe(false);
  });

  it('sets error', () => {
    useWalletStore.getState().setError('something went wrong');
    expect(useWalletStore.getState().error).toBe('something went wrong');
    useWalletStore.getState().setError(null);
    expect(useWalletStore.getState().error).toBeNull();
  });

  it('sets username on existing account', () => {
    useWalletStore.getState().setAccount(testAccount);
    useWalletStore.getState().setUsername('alice');
    expect(useWalletStore.getState().account?.username).toBe('alice');
  });

  it('does nothing when setting username without account', () => {
    useWalletStore.getState().setUsername('alice');
    expect(useWalletStore.getState().account).toBeNull();
  });

  it('preserves other account fields when setting username', () => {
    useWalletStore.getState().setAccount(testAccount);
    useWalletStore.getState().setUsername('alice');
    const account = useWalletStore.getState().account;
    expect(account?.address).toBe(testAccount.address);
    expect(account?.mnemonic).toBe(testAccount.mnemonic);
    expect(account?.nkCommit).toBe(testAccount.nkCommit);
    expect(account?.username).toBe('alice');
  });
});

describe('parseWalletPayload — versioned persistence', () => {
  it('accepts a v2 payload with mnemonic + nkCommit', () => {
    const raw = JSON.stringify({
      version: WALLET_PAYLOAD_VERSION,
      account: testAccount,
    });
    expect(parseWalletPayload(raw)).toEqual(testAccount);
  });

  it('accepts optional username and lowercases nkCommit', () => {
    const raw = JSON.stringify({
      version: WALLET_PAYLOAD_VERSION,
      account: {
        ...testAccount,
        nkCommit: 'AB'.repeat(32),
        username: 'alice',
      },
    });
    expect(parseWalletPayload(raw)).toEqual({
      ...testAccount,
      nkCommit: 'ab'.repeat(32),
      username: 'alice',
    });
  });

  it('refuses non-object JSON roots', () => {
    expect(() => parseWalletPayload('null')).toThrow(IncompatibleWalletError);
    expect(() => parseWalletPayload('"string"')).toThrow(IncompatibleWalletError);
    expect(() => parseWalletPayload('42')).toThrow(IncompatibleWalletError);
  });

  it('refuses unversioned legacy xpriv payloads', () => {
    const raw = JSON.stringify({
      account: {
        address: testAccount.address,
        xpriv: 'xprv-legacy',
      },
    });
    expect(() => parseWalletPayload(raw)).toThrow(IncompatibleWalletError);
  });

  it('refuses v2 payload whose account is not an object', () => {
    const raw = JSON.stringify({ version: 2, account: 'not-an-object' });
    expect(() => parseWalletPayload(raw)).toThrow(IncompatibleWalletError);
  });

  it('refuses v2 account that still carries xpriv without mnemonic', () => {
    const raw = JSON.stringify({
      version: 2,
      account: {
        address: testAccount.address,
        xpriv: 'xprv-still-here',
        nkCommit: testAccount.nkCommit,
      },
    });
    expect(() => parseWalletPayload(raw)).toThrow(IncompatibleWalletError);
  });

  it('refuses payload missing mnemonic/nkCommit', () => {
    const raw = JSON.stringify({
      version: 2,
      account: { address: testAccount.address },
    });
    expect(() => parseWalletPayload(raw)).toThrow(IncompatibleWalletError);
  });

  it('refuses invalid JSON', () => {
    expect(() => parseWalletPayload('not-json')).toThrow(IncompatibleWalletError);
  });
});

describe('wallet store — defensive returns when no account', () => {
  it('saveWithPassword silently returns when no account is set', async () => {
    await expect(useWalletStore.getState().saveWithPassword('pw12345678')).resolves.toBeUndefined();
    const { loadEncryptedWallet } = await import('@/lib/crypto/storage');
    expect(await loadEncryptedWallet()).toBeNull();
  });

  it('saveWithPrf silently returns when no account is set', async () => {
    const prf = crypto.getRandomValues(new Uint8Array(32));
    await expect(useWalletStore.getState().saveWithPrf(prf)).resolves.toBeUndefined();
    const { loadEncryptedWallet } = await import('@/lib/crypto/storage');
    expect(await loadEncryptedWallet()).toBeNull();
  });
});

describe('wallet store — unlock edge cases', () => {
  it('unlockWithPassword throws on a stored wallet that has no salt', async () => {
    const { saveEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'ct', iv: 'iv' },
      authMethod: 'seed',
      address: 'c'.repeat(64),
      createdAt: Date.now(),
      payloadVersion: WALLET_PAYLOAD_VERSION,
    });
    await expect(useWalletStore.getState().unlockWithPassword('any')).rejects.toThrow(
      'No salt found in stored wallet',
    );
  });

  it('marks needsSeedReimport when decrypting an incompatible payload', async () => {
    useWalletStore.getState().setAccount(testAccount);
    await useWalletStore.getState().saveWithPassword('testpassword123');

    // Overwrite ciphertext with a valid-password encrypt of a legacy blob
    // by re-saving via low-level encrypt of unversioned JSON.
    // Envelope stays at WALLET_PAYLOAD_VERSION so decrypt-then-parse runs.
    const { encrypt, deriveKeyFromPassword } = await import('@/lib/crypto/encryption');
    const { saveEncryptedWallet, loadEncryptedWallet } = await import('@/lib/crypto/storage');
    const stored = await loadEncryptedWallet();
    expect(stored).not.toBeNull();
    const saltBin = atob(stored!.encrypted.salt!);
    const salt = new Uint8Array(saltBin.length);
    for (let i = 0; i < saltBin.length; i++) salt[i] = saltBin.charCodeAt(i);
    const { key } = await deriveKeyFromPassword('testpassword123', salt);
    const legacy = JSON.stringify({
      account: { address: testAccount.address, xpriv: 'xprv…', numPubkeys: 0 },
    });
    const encrypted = await encrypt(legacy, key, salt);
    await saveEncryptedWallet({
      encrypted,
      authMethod: 'seed',
      address: testAccount.address,
      createdAt: Date.now(),
      payloadVersion: WALLET_PAYLOAD_VERSION,
    });

    useWalletStore.setState({ account: null, isLocked: true });
    await expect(useWalletStore.getState().unlockWithPassword('testpassword123')).rejects.toThrow(
      IncompatibleWalletError,
    );
    expect(useWalletStore.getState().needsSeedReimport).toBe(true);
    expect(useWalletStore.getState().account).toBeNull();
    // IndexedDB record must survive so the user can re-import or discard.
    expect(await loadEncryptedWallet()).not.toBeNull();
  });

  it('unlockWithPassword refuses foreign payloadVersion without decrypting', async () => {
    const { saveEncryptedWallet, loadEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'not-valid-ciphertext', iv: 'iv', salt: 'c2FsdA==' },
      authMethod: 'seed',
      address: testAccount.address,
      createdAt: Date.now(),
      payloadVersion: 1,
    });

    useWalletStore.setState({ account: null, isLocked: true });
    await expect(useWalletStore.getState().unlockWithPassword('any-password')).rejects.toThrow(
      IncompatibleWalletError,
    );
    const state = useWalletStore.getState();
    expect(state.needsSeedReimport).toBe(true);
    expect(state.account).toBeNull();
    expect(state.hasStoredWallet).toBe(false);
    expect(state.isLocked).toBe(false);
    expect(state.storedAddress).toBeNull();
    expect(state.storedAuthMethod).toBeNull();
    expect(state.error).toBe(
      'Stored wallet format is incompatible with this build. Re-import your 12-word seed phrase.',
    );
    expect(await loadEncryptedWallet()).not.toBeNull();
  });

  it('unlockWithPassword refuses missing payloadVersion without decrypting', async () => {
    const { saveEncryptedWallet, loadEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'garbage', iv: 'iv', salt: 'c2FsdA==' },
      authMethod: 'seed',
      address: testAccount.address,
      createdAt: Date.now(),
    });

    useWalletStore.setState({ account: null, isLocked: true });
    await expect(useWalletStore.getState().unlockWithPassword('any-password')).rejects.toThrow(
      IncompatibleWalletError,
    );
    expect(useWalletStore.getState().needsSeedReimport).toBe(true);
    expect(useWalletStore.getState().account).toBeNull();
    expect(await loadEncryptedWallet()).not.toBeNull();
  });

  it('saveWithPassword activates the account only after a successful write', async () => {
    expect(useWalletStore.getState().account).toBeNull();
    await useWalletStore.getState().saveWithPassword('pw12345678', testAccount);
    const state = useWalletStore.getState();
    expect(state.account).toEqual(testAccount);
    expect(state.hasStoredWallet).toBe(true);
    expect(state.needsSeedReimport).toBe(false);
    expect(state.isLocked).toBe(false);
  });

  it('failed saveWithPassword leaves account null and does not clear reimport', async () => {
    const storage = await import('@/lib/crypto/storage');
    const spy = vi
      .spyOn(storage, 'saveEncryptedWallet')
      .mockRejectedValueOnce(new Error('IDB write failed'));

    useWalletStore.setState({ needsSeedReimport: true, account: null });
    await expect(
      useWalletStore.getState().saveWithPassword('pw12345678', testAccount),
    ).rejects.toThrow('IDB write failed');

    const state = useWalletStore.getState();
    expect(state.account).toBeNull();
    expect(state.needsSeedReimport).toBe(true);
    expect(state.hasStoredWallet).toBe(false);
    spy.mockRestore();
  });
});

describe('wallet store — password encryption', () => {
  it('saves and unlocks with password (v2 payload)', async () => {
    useWalletStore.getState().setAccount(testAccount);
    await useWalletStore.getState().saveWithPassword('testpassword123');

    const { loadEncryptedWallet } = await import('@/lib/crypto/storage');
    const stored = await loadEncryptedWallet();
    expect(stored).not.toBeNull();
    expect(stored?.authMethod).toBe('seed');
    expect(stored?.address).toBe(testAccount.address);
    expect(stored?.payloadVersion).toBe(WALLET_PAYLOAD_VERSION);

    useWalletStore.setState({ account: null });

    await useWalletStore.getState().unlockWithPassword('testpassword123');
    const state = useWalletStore.getState();
    expect(state.account).toEqual(testAccount);
    expect(state.isLocked).toBe(false);
    expect(state.needsSeedReimport).toBe(false);
  });

  it('fails to unlock with wrong password', async () => {
    useWalletStore.getState().setAccount(testAccount);
    await useWalletStore.getState().saveWithPassword('correctpassword');
    useWalletStore.setState({ account: null });
    await expect(useWalletStore.getState().unlockWithPassword('wrongpassword')).rejects.toThrow();
  });

  it('throws when no stored wallet exists', async () => {
    await expect(useWalletStore.getState().unlockWithPassword('any')).rejects.toThrow(
      'No stored wallet found',
    );
  });
});

describe('wallet store — PRF encryption', () => {
  it('saves and unlocks with PRF output', async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));

    useWalletStore.getState().setAccount(testAccount);
    await useWalletStore.getState().saveWithPrf(prfOutput);

    const { loadEncryptedWallet } = await import('@/lib/crypto/storage');
    const stored = await loadEncryptedWallet();
    expect(stored?.authMethod).toBe('passkey');
    expect(stored?.payloadVersion).toBe(WALLET_PAYLOAD_VERSION);

    useWalletStore.setState({ account: null });

    await useWalletStore.getState().unlockWithPrf(prfOutput);
    expect(useWalletStore.getState().account).toEqual(testAccount);
  });

  it('throws when no stored wallet exists', async () => {
    const prf = crypto.getRandomValues(new Uint8Array(32));
    await expect(useWalletStore.getState().unlockWithPrf(prf)).rejects.toThrow(
      'No stored wallet found',
    );
  });

  it('fails to unlock with different PRF output', async () => {
    const prf1 = crypto.getRandomValues(new Uint8Array(32));
    const prf2 = crypto.getRandomValues(new Uint8Array(32));

    useWalletStore.getState().setAccount(testAccount);
    await useWalletStore.getState().saveWithPrf(prf1);
    useWalletStore.setState({ account: null });

    await expect(useWalletStore.getState().unlockWithPrf(prf2)).rejects.toThrow();
  });

  it('marks needsSeedReimport when PRF-decrypt yields an incompatible payload', async () => {
    const prf = crypto.getRandomValues(new Uint8Array(32));
    useWalletStore.getState().setAccount(testAccount);
    await useWalletStore.getState().saveWithPrf(prf);

    // Envelope stays at WALLET_PAYLOAD_VERSION so decrypt-then-parse runs.
    const { encrypt, deriveKeyFromPrf } = await import('@/lib/crypto/encryption');
    const { saveEncryptedWallet, loadEncryptedWallet } = await import('@/lib/crypto/storage');
    const stored = await loadEncryptedWallet();
    expect(stored).not.toBeNull();
    const key = await deriveKeyFromPrf(prf);
    const legacy = JSON.stringify({
      account: { address: testAccount.address, xpriv: 'xprv…', numPubkeys: 0 },
    });
    const encrypted = await encrypt(legacy, key);
    await saveEncryptedWallet({
      encrypted,
      authMethod: 'passkey',
      address: testAccount.address,
      createdAt: Date.now(),
      payloadVersion: WALLET_PAYLOAD_VERSION,
    });

    useWalletStore.setState({ account: null, isLocked: true });
    await expect(useWalletStore.getState().unlockWithPrf(prf)).rejects.toThrow(
      IncompatibleWalletError,
    );
    expect(useWalletStore.getState().needsSeedReimport).toBe(true);
    expect(useWalletStore.getState().account).toBeNull();
  });

  it('unlockWithPrf refuses foreign payloadVersion without decrypting', async () => {
    const prf = crypto.getRandomValues(new Uint8Array(32));
    const { saveEncryptedWallet, loadEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'not-valid-ciphertext', iv: 'iv' },
      authMethod: 'passkey',
      address: testAccount.address,
      createdAt: Date.now(),
      payloadVersion: 1,
    });

    useWalletStore.setState({ account: null, isLocked: true });
    await expect(useWalletStore.getState().unlockWithPrf(prf)).rejects.toThrow(
      IncompatibleWalletError,
    );
    const state = useWalletStore.getState();
    expect(state.needsSeedReimport).toBe(true);
    expect(state.account).toBeNull();
    expect(state.hasStoredWallet).toBe(false);
    expect(state.isLocked).toBe(false);
    expect(await loadEncryptedWallet()).not.toBeNull();
  });

  it('unlockWithPrf refuses missing payloadVersion without decrypting', async () => {
    const prf = crypto.getRandomValues(new Uint8Array(32));
    const { saveEncryptedWallet, loadEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'garbage', iv: 'iv' },
      authMethod: 'passkey',
      address: testAccount.address,
      createdAt: Date.now(),
    });

    useWalletStore.setState({ account: null, isLocked: true });
    await expect(useWalletStore.getState().unlockWithPrf(prf)).rejects.toThrow(
      IncompatibleWalletError,
    );
    expect(useWalletStore.getState().needsSeedReimport).toBe(true);
    expect(useWalletStore.getState().account).toBeNull();
    expect(await loadEncryptedWallet()).not.toBeNull();
  });
});

describe('wallet store — clearNeedsSeedReimport', () => {
  it('clears the reimport flag without touching the account', () => {
    useWalletStore.setState({
      needsSeedReimport: true,
      account: testAccount,
      error: 'legacy',
    });
    useWalletStore.getState().clearNeedsSeedReimport();
    expect(useWalletStore.getState().needsSeedReimport).toBe(false);
    expect(useWalletStore.getState().account).toEqual(testAccount);
  });
});

describe('wallet store — serialize username branch', () => {
  it('persists username when present on the account', async () => {
    const withUser = { ...testAccount, username: 'alice' };
    await useWalletStore.getState().saveWithPassword('password123', withUser);
    useWalletStore.setState({ account: null, isLocked: true });
    await useWalletStore.getState().unlockWithPassword('password123');
    expect(useWalletStore.getState().account?.username).toBe('alice');
  });
});

describe('wallet store — lock', () => {
  it('clears account and sets isLocked (no balance field)', () => {
    useWalletStore.getState().setAccount(testAccount);
    useWalletStore.getState().lock();
    const state = useWalletStore.getState();
    expect(state.account).toBeNull();
    expect(state.isLocked).toBe(true);
    expect(state.storedAddress).toBe(testAccount.address);
  });

  it('preserves storedAddress from previous lock if no account', () => {
    useWalletStore.setState({ storedAddress: 'previous-address' });
    useWalletStore.getState().lock();
    expect(useWalletStore.getState().storedAddress).toBe('previous-address');
  });
});

describe('wallet store — checkForStoredWallet', () => {
  it('detects encrypted wallet in IndexedDB', async () => {
    const { saveEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'ct', iv: 'iv' },
      authMethod: 'seed',
      address: 'x'.repeat(64),
      createdAt: Date.now(),
      payloadVersion: WALLET_PAYLOAD_VERSION,
    });
    useWalletStore.setState({ error: 'stale' });

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.hasStoredWallet).toBe(true);
    expect(state.storedAddress).toBe('x'.repeat(64));
    expect(state.storedAuthMethod).toBe('seed');
    expect(state.isLocked).toBe(true);
    expect(state.error).toBeNull();
  });

  it('requires seed re-import for IDB blob without payloadVersion and keeps the blob', async () => {
    const { saveEncryptedWallet, loadEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'ct', iv: 'iv' },
      authMethod: 'seed',
      address: 'x'.repeat(64),
      createdAt: Date.now(),
    });

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.needsSeedReimport).toBe(true);
    expect(state.hasStoredWallet).toBe(false);
    expect(state.isLocked).toBe(false);
    expect(state.account).toBeNull();
    expect(state.storedAddress).toBeNull();
    expect(state.storedAuthMethod).toBeNull();
    expect(state.error).toBe(
      'Stored wallet format is incompatible with this build. Re-import your 12-word seed phrase.',
    );
    expect(await loadEncryptedWallet()).not.toBeNull();
  });

  it('requires seed re-import for IDB blob with foreign payloadVersion and keeps the blob', async () => {
    const { saveEncryptedWallet, loadEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'ct', iv: 'iv' },
      authMethod: 'seed',
      address: 'y'.repeat(64),
      createdAt: Date.now(),
      payloadVersion: 1,
    });

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.needsSeedReimport).toBe(true);
    expect(state.hasStoredWallet).toBe(false);
    expect(state.isLocked).toBe(false);
    expect(state.account).toBeNull();
    expect(await loadEncryptedWallet()).not.toBeNull();
  });

  it('keeps legacy localStorage blobs and requires seed re-import', async () => {
    // Unversioned plaintext blobs are incompatible — never promote to account,
    // but keep the only copy until re-import or confirmed discard.
    const legacyData = {
      account: { address: testAccount.address, xpriv: 'xprv…', numPubkeys: 0 },
    };
    localStorage.setItem('zkcoins_wallet', JSON.stringify(legacyData));
    useWalletStore.setState({ error: 'stale' });

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.account).toBeNull();
    expect(state.needsSeedReimport).toBe(true);
    expect(state.hasStoredWallet).toBe(false);
    // needsSeedReimport is the gate; error is not sticky I/O / guidance here.
    expect(state.error).toBeNull();
    expect(localStorage.getItem('zkcoins_wallet')).not.toBeNull();
  });

  it('clears legacy storage only after successful v2 save', async () => {
    const legacyData = {
      account: { address: testAccount.address, xpriv: 'xprv…', numPubkeys: 0 },
    };
    localStorage.setItem('zkcoins_wallet', JSON.stringify(legacyData));
    useWalletStore.setState({
      account: testAccount,
      needsSeedReimport: true,
    });

    await useWalletStore.getState().saveWithPassword('password123');
    const state = useWalletStore.getState();
    expect(localStorage.getItem('zkcoins_wallet')).toBeNull();
    expect(state.needsSeedReimport).toBe(false);
  });

  it('does nothing when no wallet stored anywhere', async () => {
    useWalletStore.setState({ error: 'stale' });
    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.hasStoredWallet).toBe(false);
    expect(state.account).toBeNull();
    expect(state.error).toBeNull();
  });

  it('refreshes stored flags without re-locking on re-mount', async () => {
    const { saveEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'ct', iv: 'iv' },
      authMethod: 'passkey',
      address: 'b'.repeat(64),
      createdAt: Date.now(),
      payloadVersion: WALLET_PAYLOAD_VERSION,
    });

    useWalletStore.setState({
      account: testAccount,
      isLocked: false,
      hasStoredWallet: false,
      storedAddress: null,
      storedAuthMethod: null,
      error: 'stale',
    });

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.account).toEqual(testAccount);
    expect(state.isLocked).toBe(false);
    expect(state.hasStoredWallet).toBe(true);
    expect(state.storedAddress).toBe('b'.repeat(64));
    expect(state.storedAuthMethod).toBe('passkey');
    expect(state.error).toBeNull();
  });

  it('re-mount with foreign payloadVersion forces re-import and clears the unlocked account', async () => {
    const { saveEncryptedWallet, loadEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'ct', iv: 'iv' },
      authMethod: 'passkey',
      address: 'b'.repeat(64),
      createdAt: Date.now(),
      payloadVersion: 1,
    });

    useWalletStore.setState({
      account: testAccount,
      isLocked: false,
      hasStoredWallet: true,
      storedAddress: 'b'.repeat(64),
      storedAuthMethod: 'passkey',
    });

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.needsSeedReimport).toBe(true);
    expect(state.account).toBeNull();
    expect(state.hasStoredWallet).toBe(false);
    expect(state.isLocked).toBe(false);
    expect(await loadEncryptedWallet()).not.toBeNull();
  });

  it('returns early without setting flags when the unlocked account has no stored blob', async () => {
    useWalletStore.setState({
      account: testAccount,
      isLocked: false,
      hasStoredWallet: false,
      error: 'stale',
    });

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.account).toEqual(testAccount);
    expect(state.isLocked).toBe(false);
    expect(state.hasStoredWallet).toBe(false);
    expect(state.error).toBeNull();
  });

  it('surfaces loadEncryptedWallet error on unlocked path without clearing account', async () => {
    const storage = await import('@/lib/crypto/storage');
    const spy = vi
      .spyOn(storage, 'loadEncryptedWallet')
      .mockRejectedValue(new Error('IDB unavailable'));

    useWalletStore.setState({
      account: testAccount,
      isLocked: false,
      hasStoredWallet: true,
      needsSeedReimport: false,
      error: null,
    });

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.error).toBe('IDB unavailable');
    expect(state.account).toEqual(testAccount);
    expect(state.isLocked).toBe(false);
    expect(state.hasStoredWallet).toBe(true);
    expect(state.needsSeedReimport).toBe(false);
    spy.mockRestore();
  });

  it('surfaces loadEncryptedWallet non-Error throw on unlocked path without clearing account', async () => {
    const storage = await import('@/lib/crypto/storage');
    const spy = vi.spyOn(storage, 'loadEncryptedWallet').mockRejectedValue('idb-string-failure');

    useWalletStore.setState({
      account: testAccount,
      isLocked: false,
      hasStoredWallet: true,
      needsSeedReimport: false,
      error: null,
    });

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.error).toBe('idb-string-failure');
    expect(state.account).toEqual(testAccount);
    expect(state.isLocked).toBe(false);
    expect(state.hasStoredWallet).toBe(true);
    expect(state.needsSeedReimport).toBe(false);
    spy.mockRestore();
  });

  it('surfaces loadEncryptedWallet error on empty path without treating as no-blob', async () => {
    const storage = await import('@/lib/crypto/storage');
    const spy = vi
      .spyOn(storage, 'loadEncryptedWallet')
      .mockRejectedValue(new Error('IDB unavailable'));

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.error).toBe('IDB unavailable');
    expect(state.hasStoredWallet).toBe(false);
    expect(state.needsSeedReimport).toBe(false);
    expect(state.account).toBeNull();
    spy.mockRestore();
  });

  it('surfaces loadEncryptedWallet non-Error throw on empty path without treating as no-blob', async () => {
    const storage = await import('@/lib/crypto/storage');
    const spy = vi.spyOn(storage, 'loadEncryptedWallet').mockRejectedValue('idb-string-failure');

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.error).toBe('idb-string-failure');
    expect(state.hasStoredWallet).toBe(false);
    expect(state.needsSeedReimport).toBe(false);
    expect(state.account).toBeNull();
    spy.mockRestore();
  });

  it('does not fall through to legacy localStorage when loadEncryptedWallet rejects', async () => {
    localStorage.setItem(
      'zkcoins_wallet',
      JSON.stringify({ account: { address: testAccount.address, xpriv: 'xprv…', numPubkeys: 0 } }),
    );
    const storage = await import('@/lib/crypto/storage');
    const spy = vi
      .spyOn(storage, 'loadEncryptedWallet')
      .mockRejectedValue(new Error('IDB unavailable'));

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.error).toBe('IDB unavailable');
    expect(state.needsSeedReimport).toBe(false);
    expect(localStorage.getItem('zkcoins_wallet')).not.toBeNull();
    spy.mockRestore();
  });

  it('surfaces localStorage.getItem Error on the legacy path', async () => {
    const storage = await import('@/lib/crypto/storage');
    const loadSpy = vi.spyOn(storage, 'loadEncryptedWallet').mockResolvedValue(null);
    const getItemSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('localStorage blocked');
    });

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.error).toBe('localStorage blocked');
    expect(state.hasStoredWallet).toBe(false);
    expect(state.needsSeedReimport).toBe(false);
    getItemSpy.mockRestore();
    loadSpy.mockRestore();
  });

  it('surfaces localStorage.getItem non-Error throw on the legacy path', async () => {
    const storage = await import('@/lib/crypto/storage');
    const loadSpy = vi.spyOn(storage, 'loadEncryptedWallet').mockResolvedValue(null);
    const getItemSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw 'ls-string-failure';
    });

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.error).toBe('ls-string-failure');
    expect(state.hasStoredWallet).toBe(false);
    expect(state.needsSeedReimport).toBe(false);
    getItemSpy.mockRestore();
    loadSpy.mockRestore();
  });
});

describe('wallet store — deleteWallet', () => {
  it('clears IndexedDB, localStorage, and state', async () => {
    useWalletStore.getState().setAccount(testAccount);
    await useWalletStore.getState().saveWithPassword('pw12345678');
    localStorage.setItem('zkcoins_transactions', JSON.stringify([{ id: 'x' }]));

    await useWalletStore.getState().deleteWallet();

    const state = useWalletStore.getState();
    expect(state.account).toBeNull();
    expect(state.isLocked).toBe(false);
    expect(state.hasStoredWallet).toBe(false);
    expect(state.storedAddress).toBeNull();
    expect(state.storedAuthMethod).toBeNull();
    expect(state.needsSeedReimport).toBe(false);

    const { loadEncryptedWallet } = await import('@/lib/crypto/storage');
    const stored = await loadEncryptedWallet();
    expect(stored).toBeNull();

    expect(localStorage.getItem('zkcoins_transactions')).toBeNull();
  });
});
