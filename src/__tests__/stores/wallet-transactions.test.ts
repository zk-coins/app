import { describe, it, expect, beforeEach } from 'vitest';
import { useWalletStore } from '@/stores/wallet';
import type { Transaction } from '@/stores/wallet';

const makeTx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: `tx-${Math.random().toString(36).slice(2, 8)}`,
  type: 'mint',
  amount: 10_000,
  timestamp: Date.now(),
  ...overrides,
});

beforeEach(() => {
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
  localStorage.clear();
});

describe('addTransaction — prepend order', () => {
  it('first transaction becomes the only element', () => {
    const tx = makeTx({ id: 'first' });
    useWalletStore.getState().addTransaction(tx);
    const txs = useWalletStore.getState().transactions;
    expect(txs).toHaveLength(1);
    expect(txs[0].id).toBe('first');
  });

  it('newer transactions appear before older ones', () => {
    const tx1 = makeTx({ id: 'old', timestamp: 1000 });
    const tx2 = makeTx({ id: 'new', timestamp: 2000 });
    useWalletStore.getState().addTransaction(tx1);
    useWalletStore.getState().addTransaction(tx2);
    const txs = useWalletStore.getState().transactions;
    expect(txs[0].id).toBe('new');
    expect(txs[1].id).toBe('old');
  });

  it('maintains prepend order across many transactions', () => {
    for (let i = 0; i < 5; i++) {
      useWalletStore.getState().addTransaction(makeTx({ id: `tx-${i}` }));
    }
    const txs = useWalletStore.getState().transactions;
    expect(txs).toHaveLength(5);
    // Last added should be first
    expect(txs[0].id).toBe('tx-4');
    expect(txs[4].id).toBe('tx-0');
  });
});

describe('addTransaction — localStorage persistence', () => {
  it('persists to localStorage after adding a transaction', () => {
    const tx = makeTx({ id: 'persist-1' });
    useWalletStore.getState().addTransaction(tx);

    const stored = localStorage.getItem('zkcoins_transactions');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('persist-1');
  });

  it('persists all transactions after multiple adds', () => {
    useWalletStore.getState().addTransaction(makeTx({ id: 'a' }));
    useWalletStore.getState().addTransaction(makeTx({ id: 'b' }));
    useWalletStore.getState().addTransaction(makeTx({ id: 'c' }));

    const stored = localStorage.getItem('zkcoins_transactions');
    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveLength(3);
    // Prepend order: c, b, a
    expect(parsed[0].id).toBe('c');
    expect(parsed[1].id).toBe('b');
    expect(parsed[2].id).toBe('a');
  });

  it('overwrites localStorage on each add', () => {
    useWalletStore.getState().addTransaction(makeTx({ id: 'x' }));
    const first = localStorage.getItem('zkcoins_transactions');
    useWalletStore.getState().addTransaction(makeTx({ id: 'y' }));
    const second = localStorage.getItem('zkcoins_transactions');
    expect(first).not.toBe(second);
    expect(JSON.parse(second!)).toHaveLength(2);
  });
});

describe('addTransaction — all fields', () => {
  it('stores transaction with all optional fields', () => {
    const tx: Transaction = {
      id: 'full-tx',
      type: 'send',
      amount: 50_000,
      counterparty: 'alice@zkcoins.app',
      timestamp: 1700000000000,
      proofId: 'proof-42',
    };
    useWalletStore.getState().addTransaction(tx);
    const stored = useWalletStore.getState().transactions[0];
    expect(stored.id).toBe('full-tx');
    expect(stored.type).toBe('send');
    expect(stored.amount).toBe(50_000);
    expect(stored.counterparty).toBe('alice@zkcoins.app');
    expect(stored.timestamp).toBe(1700000000000);
    expect(stored.proofId).toBe('proof-42');
  });

  it('stores mint transaction without optional fields', () => {
    const tx: Transaction = {
      id: 'mint-1',
      type: 'mint',
      amount: 10_000,
      timestamp: 1700000000000,
    };
    useWalletStore.getState().addTransaction(tx);
    const stored = useWalletStore.getState().transactions[0];
    expect(stored.counterparty).toBeUndefined();
    expect(stored.proofId).toBeUndefined();
  });

  it('stores receive transaction', () => {
    const tx: Transaction = {
      id: 'recv-1',
      type: 'receive',
      amount: 25_000,
      counterparty: 'bob@zkcoins.app',
      timestamp: 1700000000000,
    };
    useWalletStore.getState().addTransaction(tx);
    const stored = useWalletStore.getState().transactions[0];
    expect(stored.type).toBe('receive');
    expect(stored.counterparty).toBe('bob@zkcoins.app');
  });

  it('persists all fields to localStorage', () => {
    const tx: Transaction = {
      id: 'persist-full',
      type: 'send',
      amount: 99_000,
      counterparty: 'charlie@zkcoins.app',
      timestamp: 1700000000000,
      proofId: 'proof-99',
    };
    useWalletStore.getState().addTransaction(tx);
    const stored = JSON.parse(localStorage.getItem('zkcoins_transactions')!);
    expect(stored[0]).toEqual(tx);
  });
});
