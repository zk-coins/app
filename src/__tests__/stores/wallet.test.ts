import { describe, it, expect, beforeEach } from 'vitest';
import { useWalletStore } from '@/stores/wallet';
import type { Account, Transaction } from '@/stores/wallet';

const testAccount: Account = {
  address: 'a'.repeat(64),
  balance: 10000,
  numPubkeys: 0,
  xpriv: 'xprv9s21ZrQH143K3GJpoapnV8SFfuZcECe',
};

const testTx: Transaction = {
  id: 'tx-1',
  type: 'mint',
  amount: 10000,
  timestamp: 1700000000000,
};

beforeEach(() => {
  // Reset store
  useWalletStore.setState({
    account: null,
    transactions: [],
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    error: null,
  });
  // IndexedDB is reset in setup.ts via fresh IDBFactory per test
  localStorage.clear();
});

describe('wallet store — basic state', () => {
  it('has correct initial state', () => {
    const state = useWalletStore.getState();
    expect(state.account).toBeNull();
    expect(state.transactions).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.isLocked).toBe(false);
    expect(state.hasStoredWallet).toBe(false);
    expect(state.error).toBeNull();
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
});

describe('wallet store — balance and pubkeys', () => {
  it('sets balance on existing account', () => {
    useWalletStore.getState().setAccount(testAccount);
    useWalletStore.getState().setBalance(42000);
    expect(useWalletStore.getState().account?.balance).toBe(42000);
  });

  it('does nothing when setting balance without account', () => {
    useWalletStore.getState().setBalance(42000);
    expect(useWalletStore.getState().account).toBeNull();
  });

  it('increments pubkeys', () => {
    useWalletStore.getState().setAccount(testAccount);
    useWalletStore.getState().incrementPubkeys();
    expect(useWalletStore.getState().account?.numPubkeys).toBe(1);
    useWalletStore.getState().incrementPubkeys();
    expect(useWalletStore.getState().account?.numPubkeys).toBe(2);
  });

  it('does nothing when incrementing without account', () => {
    useWalletStore.getState().incrementPubkeys();
    expect(useWalletStore.getState().account).toBeNull();
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
    expect(account?.balance).toBe(testAccount.balance);
    expect(account?.numPubkeys).toBe(testAccount.numPubkeys);
    expect(account?.username).toBe('alice');
  });
});

describe('wallet store — transactions', () => {
  it('adds transaction at the beginning', () => {
    useWalletStore.getState().addTransaction(testTx);
    const txs = useWalletStore.getState().transactions;
    expect(txs).toHaveLength(1);
    expect(txs[0]).toEqual(testTx);
  });

  it('prepends new transactions', () => {
    const tx1 = { ...testTx, id: 'tx-1' };
    const tx2 = { ...testTx, id: 'tx-2', type: 'send' as const, amount: 500 };
    useWalletStore.getState().addTransaction(tx1);
    useWalletStore.getState().addTransaction(tx2);
    const txs = useWalletStore.getState().transactions;
    expect(txs[0].id).toBe('tx-2');
    expect(txs[1].id).toBe('tx-1');
  });

  it('persists transactions to localStorage', () => {
    useWalletStore.getState().addTransaction(testTx);
    const stored = localStorage.getItem('zkcoins_transactions');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('tx-1');
  });
});

describe('wallet store — password encryption', () => {
  it('saves and unlocks with password', async () => {
    // Set up account
    useWalletStore.getState().setAccount(testAccount);
    useWalletStore.getState().addTransaction(testTx);

    // Save encrypted
    await useWalletStore.getState().saveWithPassword('testpassword123');

    // Verify wallet is stored in IndexedDB
    const { loadEncryptedWallet } = await import('@/lib/crypto/storage');
    const stored = await loadEncryptedWallet();
    expect(stored).not.toBeNull();
    expect(stored?.authMethod).toBe('seed');
    expect(stored?.address).toBe(testAccount.address);

    // Clear state to simulate page reload
    useWalletStore.setState({ account: null, transactions: [] });

    // Unlock
    await useWalletStore.getState().unlockWithPassword('testpassword123');
    const state = useWalletStore.getState();
    expect(state.account).toEqual(testAccount);
    expect(state.transactions).toHaveLength(1);
    expect(state.isLocked).toBe(false);
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

    // Verify stored
    const { loadEncryptedWallet } = await import('@/lib/crypto/storage');
    const stored = await loadEncryptedWallet();
    expect(stored?.authMethod).toBe('passkey');

    // Simulate reload
    useWalletStore.setState({ account: null, transactions: [] });

    // Unlock with same PRF
    await useWalletStore.getState().unlockWithPrf(prfOutput);
    expect(useWalletStore.getState().account).toEqual(testAccount);
  });

  it('fails to unlock with different PRF output', async () => {
    const prf1 = crypto.getRandomValues(new Uint8Array(32));
    const prf2 = crypto.getRandomValues(new Uint8Array(32));

    useWalletStore.getState().setAccount(testAccount);
    await useWalletStore.getState().saveWithPrf(prf1);
    useWalletStore.setState({ account: null });

    await expect(useWalletStore.getState().unlockWithPrf(prf2)).rejects.toThrow();
  });
});

describe('wallet store — lock', () => {
  it('clears account and sets isLocked', () => {
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
    });

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.hasStoredWallet).toBe(true);
    expect(state.storedAddress).toBe('x'.repeat(64));
    expect(state.storedAuthMethod).toBe('seed');
    expect(state.isLocked).toBe(true);
  });

  it('loads legacy localStorage wallet directly', async () => {
    const legacyData = {
      account: testAccount,
      transactions: [testTx],
    };
    localStorage.setItem('zkcoins_wallet', JSON.stringify(legacyData));

    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.account).toEqual(testAccount);
    expect(state.transactions).toHaveLength(1);
    expect(state.isLocked).toBe(false);
    expect(state.hasStoredWallet).toBe(false);
  });

  it('does nothing when no wallet stored anywhere', async () => {
    await useWalletStore.getState().checkForStoredWallet();
    const state = useWalletStore.getState();
    expect(state.hasStoredWallet).toBe(false);
    expect(state.account).toBeNull();
  });
});

describe('wallet store — deleteWallet', () => {
  it('clears IndexedDB, localStorage, and state', async () => {
    useWalletStore.getState().setAccount(testAccount);
    useWalletStore.getState().addTransaction(testTx);
    await useWalletStore.getState().saveWithPassword('pw12345678');

    await useWalletStore.getState().deleteWallet();

    const state = useWalletStore.getState();
    expect(state.account).toBeNull();
    expect(state.transactions).toEqual([]);
    expect(state.isLocked).toBe(false);
    expect(state.hasStoredWallet).toBe(false);
    expect(state.storedAddress).toBeNull();
    expect(state.storedAuthMethod).toBeNull();

    // IndexedDB should be empty
    const { loadEncryptedWallet } = await import('@/lib/crypto/storage');
    const stored = await loadEncryptedWallet();
    expect(stored).toBeNull();

    // localStorage transactions should be removed
    expect(localStorage.getItem('zkcoins_transactions')).toBeNull();
  });
});
