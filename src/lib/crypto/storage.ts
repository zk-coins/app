/**
 * IndexedDB-based storage for zkCoins wallet.
 *
 * Stores:
 * - Passkey metadata (credential ID, derivation version)
 * - Encrypted wallet data (xpriv + account info encrypted with AES-GCM)
 *
 * The xpriv is NEVER stored in plaintext.
 */

import type { EncryptedData } from './encryption';

const DB_NAME = 'zkcoins-wallet';
const DB_VERSION = 2;
const CREDENTIALS_STORE = 'credentials';
const WALLET_STORE = 'wallet';
const CREDENTIAL_KEY = 'passkey';
const WALLET_KEY = 'encrypted-wallet';

export interface StoredCredential {
  credentialId: string;
  derivationVersion: string;
  createdAt: number;
}

export interface StoredWallet {
  encrypted: EncryptedData;
  authMethod: 'passkey' | 'seed';
  address: string; // stored unencrypted for display while locked
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;
      // The migration branches only fire when an older version exists locally;
      // a fresh fake-indexeddb factory per test always enters the v0 -> v2
      // path and never the in-between cases.
      /* c8 ignore start */
      if (oldVersion < 1) {
        db.createObjectStore(CREDENTIALS_STORE);
      }
      if (oldVersion < 2) {
        db.createObjectStore(WALLET_STORE);
      }
      /* c8 ignore stop */
    };
    request.onsuccess = () => resolve(request.result);
    /* c8 ignore next */
    request.onerror = () => reject(request.error);
  });
}

// --- Credential storage (passkey metadata) ---

export async function saveCredential(credential: StoredCredential): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CREDENTIALS_STORE, 'readwrite');
    tx.objectStore(CREDENTIALS_STORE).put(credential, CREDENTIAL_KEY);
    tx.oncomplete = () => resolve();
    /* c8 ignore next */
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadCredential(): Promise<StoredCredential | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CREDENTIALS_STORE, 'readonly');
    const request = tx.objectStore(CREDENTIALS_STORE).get(CREDENTIAL_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    /* c8 ignore next */
    request.onerror = () => reject(request.error);
  });
}

export async function deleteCredential(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CREDENTIALS_STORE, 'readwrite');
    tx.objectStore(CREDENTIALS_STORE).delete(CREDENTIAL_KEY);
    tx.oncomplete = () => resolve();
    /* c8 ignore next */
    tx.onerror = () => reject(tx.error);
  });
}

// --- Encrypted wallet storage ---

export async function saveEncryptedWallet(wallet: StoredWallet): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WALLET_STORE, 'readwrite');
    tx.objectStore(WALLET_STORE).put(wallet, WALLET_KEY);
    tx.oncomplete = () => resolve();
    /* c8 ignore next */
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadEncryptedWallet(): Promise<StoredWallet | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WALLET_STORE, 'readonly');
    const request = tx.objectStore(WALLET_STORE).get(WALLET_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    /* c8 ignore next */
    request.onerror = () => reject(request.error);
  });
}

export async function deleteEncryptedWallet(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WALLET_STORE, 'readwrite');
    tx.objectStore(WALLET_STORE).delete(WALLET_KEY);
    tx.oncomplete = () => resolve();
    /* c8 ignore next */
    tx.onerror = () => reject(tx.error);
  });
}

// --- Migration: clear old localStorage data ---

export function clearLegacyStorage(): void {
  /* c8 ignore next — SSR guard, unreachable in the browser test env */
  if (typeof window === 'undefined') return;
  localStorage.removeItem('zkcoins_wallet');
  localStorage.removeItem('zkcoins_auth');
}
