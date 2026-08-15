import { create } from 'zustand';
import { encrypt, decrypt, deriveKeyFromPassword, deriveKeyFromPrf } from '@/lib/crypto/encryption';
import {
  saveEncryptedWallet,
  loadEncryptedWallet,
  deleteEncryptedWallet,
  clearLegacyStorage,
} from '@/lib/crypto/storage';
import { accountKeysFromMnemonic } from '@/lib/crypto/account-keys';

/**
 * On-disk / in-memory wallet payload version.
 * v1 (unversioned): legacy `{ account: { xpriv, address, numPubkeys, … } }`
 * v2: `{ version: 2, account: { address, mnemonic, nkCommit, username? } }`
 */
export const WALLET_PAYLOAD_VERSION = 2 as const;

export class IncompatibleWalletError extends Error {
  constructor(
    message = 'Stored wallet format is incompatible with this build. Re-import your 12-word seed phrase.',
  ) {
    super(message);
    this.name = 'IncompatibleWalletError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Fail closed when stored address/nkCommit do not match the mnemonic. */
function assertCustodyTriple(account: Account): void {
  let derived;
  try {
    derived = accountKeysFromMnemonic(account.mnemonic);
  } catch (err) {
    throw new IncompatibleWalletError(
      err instanceof Error ? err.message : 'Custody key derivation failed',
    );
  }
  if (derived.address !== account.address) {
    throw new IncompatibleWalletError('Stored address does not match mnemonic-derived address');
  }
  if (derived.nkCommit.toLowerCase() !== account.nkCommit.toLowerCase()) {
    throw new IncompatibleWalletError('Stored nkCommit does not match mnemonic-derived nkCommit');
  }
}

export interface Account {
  /** Bech32m `zk1…` subject (never shown as primary identity when a name is set). */
  address: string;
  /** BIP-39 mnemonic — signing material; never leaves the device unencrypted. */
  mnemonic: string;
  /** 32-byte nk_commit as lowercase hex (bound into the address). */
  nkCommit: string;
  /** Display name (normalized email-style) when provisioned. */
  username?: string;
}

interface WalletPayloadV2 {
  version: typeof WALLET_PAYLOAD_VERSION;
  account: {
    address: string;
    mnemonic: string;
    nkCommit: string;
    username?: string;
  };
}

/**
 * Parse and validate decrypted wallet JSON. Never loads unversioned /
 * xpriv-era blobs as a live account — that would treat an incompatible
 * store as a new identity.
 */
export function parseWalletPayload(raw: string): Account {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new IncompatibleWalletError('Stored wallet payload is not valid JSON.');
  }
  if (typeof data !== 'object' || data === null) {
    throw new IncompatibleWalletError();
  }
  const obj = data as Record<string, unknown>;

  // Unversioned or pre-v2 (xpriv era): refuse — require explicit re-import.
  if (obj.version === undefined || obj.version !== WALLET_PAYLOAD_VERSION) {
    throw new IncompatibleWalletError();
  }

  const account = obj.account;
  if (typeof account !== 'object' || account === null) {
    throw new IncompatibleWalletError();
  }
  const acc = account as Record<string, unknown>;

  // Legacy field still present without mnemonic → incompatible store.
  if (typeof acc.xpriv === 'string' && typeof acc.mnemonic !== 'string') {
    throw new IncompatibleWalletError();
  }

  if (
    typeof acc.address !== 'string' ||
    acc.address.length === 0 ||
    typeof acc.mnemonic !== 'string' ||
    acc.mnemonic.trim().length === 0 ||
    typeof acc.nkCommit !== 'string' ||
    !/^[0-9a-fA-F]{64}$/.test(acc.nkCommit)
  ) {
    throw new IncompatibleWalletError(
      'Stored wallet is missing mnemonic/nkCommit/address. Re-import your 12-word seed phrase.',
    );
  }

  return {
    address: acc.address,
    mnemonic: acc.mnemonic.trim(),
    nkCommit: acc.nkCommit.toLowerCase(),
    ...(typeof acc.username === 'string' && acc.username.length > 0
      ? { username: acc.username }
      : {}),
  };
}

function serializeWalletPayload(account: Account): string {
  const payload: WalletPayloadV2 = {
    version: WALLET_PAYLOAD_VERSION,
    account: {
      address: account.address,
      mnemonic: account.mnemonic,
      nkCommit: account.nkCommit,
      ...(account.username !== undefined ? { username: account.username } : {}),
    },
  };
  return JSON.stringify(payload);
}

/** Tab-lifetime unlocked session so a same-tab hard navigation keeps custody. */
export const WALLET_SESSION_KEY = 'zkcoins.wallet.session.v2';

export function loadUnlockedSession(): Account | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(WALLET_SESSION_KEY);
    if (raw === null || raw.length === 0) return null;
    const account = parseWalletPayload(raw);
    assertCustodyTriple(account);
    return account;
  } catch {
    try {
      sessionStorage.removeItem(WALLET_SESSION_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

function persistUnlockedSession(account: Account | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (account === null) {
      sessionStorage.removeItem(WALLET_SESSION_KEY);
      return;
    }
    assertCustodyTriple(account);
    sessionStorage.setItem(WALLET_SESSION_KEY, serializeWalletPayload(account));
  } catch {
    // sessionStorage unavailable — in-memory account still works for SPA nav
  }
}

/** Outer-envelope reimport transition — blob stays in IDB; no decrypt. */
function incompatibleStoredWalletState() {
  persistUnlockedSession(null);
  return {
    needsSeedReimport: true as const,
    account: null,
    hasStoredWallet: false,
    isLocked: false,
    storedAddress: null,
    storedAuthMethod: null,
    error:
      'Stored wallet format is incompatible with this build. Re-import your 12-word seed phrase.',
  };
}

interface WalletState {
  account: Account | null;
  isLoading: boolean;
  isLocked: boolean;
  hasStoredWallet: boolean;
  storedAddress: string | null;
  storedAuthMethod: 'passkey' | 'seed' | null;
  error: string | null;
  /**
   * Set when unlock fails because the on-disk schema is incompatible
   * (xpriv → mnemonic migration). UI must force re-import, not invent state.
   */
  needsSeedReimport: boolean;

  setAccount: (account: Account | null) => void;
  setUsername: (username: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  /**
   * Encrypt and persist. When `accountToSave` is provided, activate that
   * account only after a successful v2 write (atomic create/reimport —
   * never expose an in-memory account that did not survive IDB).
   * Throws if neither `accountToSave` nor a live store account is present.
   */
  saveWithPassword: (password: string, accountToSave?: Account) => Promise<void>;
  /**
   * Encrypt and persist with PRF. Same atomic activation rule as
   * `saveWithPassword` when `accountToSave` is provided.
   * Throws if neither `accountToSave` nor a live store account is present.
   */
  saveWithPrf: (prfOutput: Uint8Array, accountToSave?: Account) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  unlockWithPrf: (prfOutput: Uint8Array) => Promise<void>;
  lock: () => void;
  /**
   * Rehydrate an unlocked tab session from sessionStorage (sync).
   * Used on hard navigation so `/send` does not bounce to Unlock.
   * Returns true when an account was restored.
   */
  restoreUnlockedSession: () => boolean;
  checkForStoredWallet: () => Promise<void>;
  deleteWallet: () => Promise<void>;
  clearNeedsSeedReimport: () => void;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  account: null,
  isLoading: false,
  isLocked: false,
  hasStoredWallet: false,
  storedAddress: null,
  storedAuthMethod: null,
  error: null,
  needsSeedReimport: false,

  setAccount: (account) => {
    persistUnlockedSession(account);
    set({ account });
  },

  setUsername: (username) => {
    const { account } = get();
    if (account) {
      const next = { ...account, username };
      persistUnlockedSession(next);
      set({ account: next });
    }
  },

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  clearNeedsSeedReimport: () => set({ needsSeedReimport: false }),

  saveWithPassword: async (password: string, accountToSave?: Account) => {
    const account = accountToSave ?? get().account;
    if (!account) {
      throw new Error('No account to save');
    }

    assertCustodyTriple(account);

    const walletData = serializeWalletPayload(account);
    const { key, salt } = await deriveKeyFromPassword(password);
    const encrypted = await encrypt(walletData, key, salt);

    await saveEncryptedWallet({
      encrypted,
      authMethod: 'seed',
      address: account.address,
      createdAt: Date.now(),
      payloadVersion: WALLET_PAYLOAD_VERSION,
    });

    // Successful v2 write: activate account only now, drop legacy blob.
    clearLegacyStorage();
    persistUnlockedSession(account);
    set({
      account,
      isLocked: false,
      needsSeedReimport: false,
      error: null,
      hasStoredWallet: true,
      storedAddress: account.address,
      storedAuthMethod: 'seed',
    });
  },

  saveWithPrf: async (prfOutput: Uint8Array, accountToSave?: Account) => {
    const account = accountToSave ?? get().account;
    if (!account) {
      throw new Error('No account to save');
    }

    assertCustodyTriple(account);

    const walletData = serializeWalletPayload(account);
    const key = await deriveKeyFromPrf(prfOutput);
    const encrypted = await encrypt(walletData, key);

    await saveEncryptedWallet({
      encrypted,
      authMethod: 'passkey',
      address: account.address,
      createdAt: Date.now(),
      payloadVersion: WALLET_PAYLOAD_VERSION,
    });

    clearLegacyStorage();
    persistUnlockedSession(account);
    set({
      account,
      isLocked: false,
      needsSeedReimport: false,
      error: null,
      hasStoredWallet: true,
      storedAddress: account.address,
      storedAuthMethod: 'passkey',
    });
  },

  unlockWithPassword: async (password: string) => {
    const stored = await loadEncryptedWallet();
    if (!stored) throw new Error('No stored wallet found');

    if (stored.payloadVersion !== WALLET_PAYLOAD_VERSION) {
      set(incompatibleStoredWalletState());
      throw new IncompatibleWalletError();
    }

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

    try {
      const account = parseWalletPayload(decrypted);
      assertCustodyTriple(account);
      persistUnlockedSession(account);
      set({
        account,
        isLocked: false,
        needsSeedReimport: false,
        error: null,
      });
    } catch (err) {
      // parseWalletPayload + assertCustodyTriple throw IncompatibleWalletError;
      // surface as forced re-import rather than a half-unlocked store.
      persistUnlockedSession(null);
      set({
        account: null,
        isLocked: true,
        needsSeedReimport: true,
        error: (err as Error).message,
      });
      throw err;
    }
  },

  unlockWithPrf: async (prfOutput: Uint8Array) => {
    const stored = await loadEncryptedWallet();
    if (!stored) throw new Error('No stored wallet found');

    if (stored.payloadVersion !== WALLET_PAYLOAD_VERSION) {
      set(incompatibleStoredWalletState());
      throw new IncompatibleWalletError();
    }

    const key = await deriveKeyFromPrf(prfOutput);
    const decrypted = await decrypt(stored.encrypted, key);

    try {
      const account = parseWalletPayload(decrypted);
      assertCustodyTriple(account);
      persistUnlockedSession(account);
      set({
        account,
        isLocked: false,
        needsSeedReimport: false,
        error: null,
      });
    } catch (err) {
      // parse + custody throw IncompatibleWalletError; keep store locked.
      persistUnlockedSession(null);
      set({
        account: null,
        isLocked: true,
        needsSeedReimport: true,
        error: (err as Error).message,
      });
      throw err;
    }
  },

  lock: () => {
    const { account } = get();
    persistUnlockedSession(null);
    set({
      account: null,
      isLocked: true,
      storedAddress: account?.address ?? get().storedAddress,
    });
  },

  restoreUnlockedSession: () => {
    if (get().needsSeedReimport) return false;
    const existing = get().account;
    if (existing && !get().isLocked) return true;
    const session = loadUnlockedSession();
    if (!session) return false;
    set({
      account: session,
      isLocked: false,
      hasStoredWallet: true,
      storedAddress: session.address,
      error: null,
    });
    return true;
  },

  checkForStoredWallet: async () => {
    get().restoreUnlockedSession();
    const current = get();
    if (current.account && !current.isLocked) {
      try {
        const stored = await loadEncryptedWallet();
        if (stored) {
          if (stored.payloadVersion !== WALLET_PAYLOAD_VERSION) {
            set(incompatibleStoredWalletState());
          } else {
            set({
              hasStoredWallet: true,
              storedAddress: stored.address,
              storedAuthMethod: stored.authMethod,
              error: null,
            });
          }
        } else {
          // Successful empty read — clear a prior storage error; leave account.
          set({ error: null });
        }
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    try {
      const stored = await loadEncryptedWallet();
      if (stored) {
        if (stored.payloadVersion !== WALLET_PAYLOAD_VERSION) {
          set(incompatibleStoredWalletState());
        } else {
          set({
            hasStoredWallet: true,
            storedAddress: stored.address,
            storedAuthMethod: stored.authMethod,
            isLocked: true,
            error: null,
          });
        }
        return;
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    /* c8 ignore next — SSR guard, unreachable in the browser test env */
    if (typeof window !== 'undefined') {
      try {
        const legacy = localStorage.getItem('zkcoins_wallet');
        if (legacy) {
          // Never auto-promote legacy localStorage blobs (unversioned /
          // xpriv-era). Keep the blob until the user re-imports or
          // explicitly resets — deleting here would destroy the only copy
          // before a conscious recovery decision.
          // needsSeedReimport is the gate; error stays null (not sticky I/O).
          persistUnlockedSession(null);
          set({
            needsSeedReimport: true,
            hasStoredWallet: false,
            storedAddress: null,
            storedAuthMethod: null,
            isLocked: false,
            account: null,
            error: null,
          });
          return;
        }
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
        return;
      }
    }

    // Successful empty read: neither IDB nor legacy held a wallet.
    set({ error: null });
  },

  deleteWallet: async () => {
    await deleteEncryptedWallet();
    clearLegacyStorage();
    persistUnlockedSession(null);
    // Visible flags last: UI that keys off hasStoredWallet / needsSeedReimport
    // must not unmount before durable cleanup finishes.
    set({
      account: null,
      isLocked: false,
      hasStoredWallet: false,
      storedAddress: null,
      storedAuthMethod: null,
      needsSeedReimport: false,
      error: null,
    });
  },
}));
