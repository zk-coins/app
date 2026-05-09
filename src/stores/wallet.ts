import { create } from 'zustand';
import { encrypt, decrypt, deriveKeyFromPassword, deriveKeyFromPrf } from '@/lib/crypto/encryption';
import {
  saveEncryptedWallet,
  loadEncryptedWallet,
  deleteEncryptedWallet,
  clearLegacyStorage,
  type StoredWallet,
} from '@/lib/crypto/storage';

export interface Account {
  address: string;
  balance: number;
  numPubkeys: number;
  xpriv: string;
  username?: string;
}

export interface Transaction {
  id: string;
  type: 'mint' | 'send' | 'receive';
  amount: number;
  counterparty?: string;
  timestamp: number;
  proofId?: string;
}

interface WalletState {
  account: Account | null;
  transactions: Transaction[];
  isLoading: boolean;
  isLocked: boolean;
  hasStoredWallet: boolean;
  storedAddress: string | null;
  storedAuthMethod: 'passkey' | 'seed' | null;
  error: string | null;

  setAccount: (account: Account | null) => void;
  setBalance: (balance: number) => void;
  setUsername: (username: string) => void;
  incrementPubkeys: () => void;
  addTransaction: (tx: Transaction) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Encrypted storage operations
  saveWithPassword: (password: string) => Promise<void>;
  saveWithPrf: (prfOutput: Uint8Array) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  unlockWithPrf: (prfOutput: Uint8Array) => Promise<void>;
  lock: () => void;
  checkForStoredWallet: () => Promise<void>;
  deleteWallet: () => Promise<void>;
}

// Keep transactions in localStorage (not sensitive)
const TX_STORAGE_KEY = 'zkcoins_transactions';

function loadTransactions(): Transaction[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(TX_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveTransactions(transactions: Transaction[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TX_STORAGE_KEY, JSON.stringify(transactions));
}

export const useWalletStore = create<WalletState>((set, get) => ({
  account: null,
  transactions: [],
  isLoading: false,
  isLocked: false,
  hasStoredWallet: false,
  storedAddress: null,
  storedAuthMethod: null,
  error: null,

  setAccount: (account) => set({ account }),

  setBalance: (balance) => {
    const { account } = get();
    if (account) {
      set({ account: { ...account, balance } });
    }
  },

  setUsername: (username) => {
    const { account } = get();
    if (account) {
      set({ account: { ...account, username } });
    }
  },

  incrementPubkeys: () => {
    const { account } = get();
    if (account) {
      set({ account: { ...account, numPubkeys: account.numPubkeys + 1 } });
    }
  },

  addTransaction: (tx) => {
    const transactions = [tx, ...get().transactions];
    set({ transactions });
    saveTransactions(transactions);
  },

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  saveWithPassword: async (password: string) => {
    const { account, transactions } = get();
    if (!account) return;

    const walletData = JSON.stringify({ account, transactions });
    const { key, salt } = await deriveKeyFromPassword(password);
    const encrypted = await encrypt(walletData, key, salt);

    await saveEncryptedWallet({
      encrypted,
      authMethod: 'seed',
      address: account.address,
      createdAt: Date.now(),
    });

    clearLegacyStorage();
  },

  saveWithPrf: async (prfOutput: Uint8Array) => {
    const { account, transactions } = get();
    if (!account) return;

    const walletData = JSON.stringify({ account, transactions });
    const key = await deriveKeyFromPrf(prfOutput);
    const encrypted = await encrypt(walletData, key);

    await saveEncryptedWallet({
      encrypted,
      authMethod: 'passkey',
      address: account.address,
      createdAt: Date.now(),
    });

    clearLegacyStorage();
  },

  unlockWithPassword: async (password: string) => {
    const stored = await loadEncryptedWallet();
    if (!stored) throw new Error('No stored wallet found');

    const salt = stored.encrypted.salt
      ? (() => {
          const binary = atob(stored.encrypted.salt!);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          return bytes;
        })()
      : undefined;

    if (!salt) throw new Error('No salt found in stored wallet');

    const { key } = await deriveKeyFromPassword(password, salt);
    const decrypted = await decrypt(stored.encrypted, key);
    const data = JSON.parse(decrypted);

    set({
      account: data.account,
      transactions: data.transactions || [],
      isLocked: false,
    });
  },

  unlockWithPrf: async (prfOutput: Uint8Array) => {
    const stored = await loadEncryptedWallet();
    if (!stored) throw new Error('No stored wallet found');

    const key = await deriveKeyFromPrf(prfOutput);
    const decrypted = await decrypt(stored.encrypted, key);
    const data = JSON.parse(decrypted);

    set({
      account: data.account,
      transactions: data.transactions || [],
      isLocked: false,
    });
  },

  lock: () => {
    const { account } = get();
    set({
      account: null,
      isLocked: true,
      storedAddress: account?.address ?? get().storedAddress,
    });
  },

  checkForStoredWallet: async () => {
    // If we already have an unlocked account in memory, this is a re-mount
    // (e.g., navigating /apps -> /). Don't re-lock — just refresh the
    // hasStoredWallet flag without touching isLocked.
    const current = get();
    if (current.account && !current.isLocked) {
      try {
        const stored = await loadEncryptedWallet();
        if (stored) {
          set({
            hasStoredWallet: true,
            storedAddress: stored.address,
            storedAuthMethod: stored.authMethod,
          });
        }
      } catch {
        // IndexedDB not available
      }
      return;
    }

    // Check IndexedDB for encrypted wallet
    try {
      const stored = await loadEncryptedWallet();
      if (stored) {
        set({
          hasStoredWallet: true,
          storedAddress: stored.address,
          storedAuthMethod: stored.authMethod,
          isLocked: true,
        });
        return;
      }
    } catch {
      // IndexedDB not available
    }

    // Check legacy localStorage
    if (typeof window !== 'undefined') {
      try {
        const legacy = localStorage.getItem('zkcoins_wallet');
        if (legacy) {
          const data = JSON.parse(legacy);
          if (data.account) {
            // Load legacy data directly (will be migrated on next save)
            set({
              account: data.account,
              transactions: data.transactions || [],
              isLocked: false,
              hasStoredWallet: false,
            });
          }
        }
      } catch {
        // ignore
      }
    }
  },

  deleteWallet: async () => {
    await deleteEncryptedWallet();
    clearLegacyStorage();
    localStorage.removeItem(TX_STORAGE_KEY);
    set({
      account: null,
      transactions: [],
      isLocked: false,
      hasStoredWallet: false,
      storedAddress: null,
      storedAuthMethod: null,
    });
  },
}));
