import { create } from 'zustand';

export interface Account {
  address: string;
  balance: number;
  numPubkeys: number;
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
  error: string | null;

  setAccount: (account: Account | null) => void;
  setBalance: (balance: number) => void;
  incrementPubkeys: () => void;
  addTransaction: (tx: Transaction) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  loadFromStorage: () => void;
  saveToStorage: () => void;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  account: null,
  transactions: [],
  isLoading: false,
  error: null,

  setAccount: (account) => {
    set({ account });
    get().saveToStorage();
  },

  setBalance: (balance) => {
    const { account } = get();
    if (account) {
      set({ account: { ...account, balance } });
      get().saveToStorage();
    }
  },

  incrementPubkeys: () => {
    const { account } = get();
    if (account) {
      set({ account: { ...account, numPubkeys: account.numPubkeys + 1 } });
      get().saveToStorage();
    }
  },

  addTransaction: (tx) => {
    set((state) => ({ transactions: [tx, ...state.transactions] }));
    get().saveToStorage();
  },

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  loadFromStorage: () => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem('zkcoins_wallet');
      if (stored) {
        const data = JSON.parse(stored);
        set({
          account: data.account || null,
          transactions: data.transactions || [],
        });
      }
    } catch {
      // ignore parse errors
    }
  },

  saveToStorage: () => {
    if (typeof window === 'undefined') return;
    const { account, transactions } = get();
    localStorage.setItem('zkcoins_wallet', JSON.stringify({ account, transactions }));
  },
}));
