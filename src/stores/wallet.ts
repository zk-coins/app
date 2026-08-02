import { create } from 'zustand';
import { encrypt, decrypt, deriveKeyFromPassword, deriveKeyFromPrf } from '@/lib/crypto/encryption';
import {
  saveEncryptedWallet,
  loadEncryptedWallet,
  deleteEncryptedWallet,
  clearLegacyStorage,
} from '@/lib/crypto/storage';

export interface Account {
  /** Bech32m `zk1…` subject (never shown as primary identity when a name is set). */
  address: string;
  /** BIP-39 mnemonic — signing material; never leaves the device unencrypted. */
  mnemonic: string;
  /** 32-byte nk_commit as lowercase hex (bound into the address). */
  nkCommit: string;
  /** Local mirror of send_counter; server head is the source of truth. */
  numPubkeys: number;
  /** Display name (normalized email-style) when provisioned. */
  username?: string;
}

interface WalletState {
  account: Account | null;
  // Server-state, never persisted. `null` = not fetched yet (post-unlock /
  // post-restore, before the first balance tick). `0` = empty wallet.
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
   * Sync the local `numPubkeys` counter from the server's send_counter.
   * No-op if no account is loaded, or if the local counter already matches.
   */
  syncNumPubkeys: (numSends: number) => void;
  incrementPubkeys: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  saveWithPassword: (password: string) => Promise<void>;
  saveWithPrf: (prfOutput: Uint8Array) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  unlockWithPrf: (prfOutput: Uint8Array) => Promise<void>;
  lock: () => void;
  checkForStoredWallet: () => Promise<void>;
  deleteWallet: () => Promise<void>;
}

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

    /* c8 ignore next — SSR guard, unreachable in the browser test env */
    if (typeof window !== 'undefined') {
      try {
        const legacy = localStorage.getItem('zkcoins_wallet');
        if (legacy) {
          const data = JSON.parse(legacy);
          if (data.account) {
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
