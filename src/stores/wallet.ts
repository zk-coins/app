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
  numPubkeys: number;
  xpriv: string;
  username?: string;
}

interface WalletState {
  account: Account | null;
  // Server-state, never persisted. `null` = not fetched yet (post-unlock /
  // post-restore, before the first /api/balance tick). `0` = empty wallet.
  // Components must distinguish the two to avoid a "Wallet is empty" flash.
  balance: number | null;
  isLoading: boolean;
  isLocked: boolean;
  hasStoredWallet: boolean;
  storedAddress: string | null;
  storedAuthMethod: 'passkey' | 'seed' | null;
  error: string | null;

  setAccount: (account: Account | null) => void;
  setBalance: (balance: number) => void;
  setUsername: (username: string) => void;
  /**
   * Sync the local `numPubkeys` counter from the server's
   * `BalanceResponse.num_sends`. The server is the source of truth
   * for the BIP-32 child-index counter — see the field doc on
   * `BalanceResponseSchema`. Callers (WalletScreen, SendPage) pass
   * the value through from every balance tick so a seed-restored
   * wallet auto-heals to the correct index without local
   * bookkeeping.
   *
   * No-op if no account is loaded, or if the local counter already
   * matches the server (avoids an unnecessary React re-render).
   */
  syncNumPubkeys: (numSends: number) => void;
  incrementPubkeys: () => void;
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

// NOTE: transaction history is deliberately NOT stored here. It is
// server-owned truth, fetched from `GET /api/history` via `useHistory`
// (issue #175) — a local copy would drift on every fresh tab, cleared
// storage, or second device. See CONTRIBUTING.md § Thin Client.

export const useWalletStore = create<WalletState>((set, get) => ({
  account: null,
  balance: null,
  isLoading: false,
  isLocked: false,
  hasStoredWallet: false,
  storedAddress: null,
  storedAuthMethod: null,
  error: null,

  setAccount: (account) => set({ account }),

  setBalance: (balance) => set({ balance }),

  setUsername: (username) => {
    const { account } = get();
    if (account) {
      set({ account: { ...account, username } });
    }
  },

  syncNumPubkeys: (numSends: number) => {
    const { account } = get();
    if (!account) return;
    if (account.numPubkeys === numSends) return;
    set({ account: { ...account, numPubkeys: numSends } });
  },

  incrementPubkeys: () => {
    const { account } = get();
    if (account) {
      set({ account: { ...account, numPubkeys: account.numPubkeys + 1 } });
    }
  },

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  saveWithPassword: async (password: string) => {
    const { account } = get();
    if (!account) return;

    const walletData = JSON.stringify({ account });
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
    const { account } = get();
    if (!account) return;

    const walletData = JSON.stringify({ account });
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
      balance: null,
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
      balance: null,
      isLocked: false,
    });
  },

  lock: () => {
    const { account } = get();
    set({
      account: null,
      balance: null,
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
    /* c8 ignore next — SSR guard, unreachable in the browser test env */
    if (typeof window !== 'undefined') {
      try {
        const legacy = localStorage.getItem('zkcoins_wallet');
        if (legacy) {
          const data = JSON.parse(legacy);
          if (data.account) {
            // Load legacy data directly (will be migrated on next save)
            set({
              account: data.account,
              balance: null,
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
    set({
      account: null,
      balance: null,
      isLocked: false,
      hasStoredWallet: false,
      storedAddress: null,
      storedAuthMethod: null,
    });
  },
}));
