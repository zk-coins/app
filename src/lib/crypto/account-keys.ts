/**
 * v1 account key material — pure-TS via `@zkcoins/sdk`.
 *
 * Derives the SPEND / NK branches of the §1.2 tree and the Bech32m address
 * `H(pk0 ‖ nk_commit)`. Replaces the in-tree WASM crypto path.
 */

import { HDKey } from '@scure/bip32';
import {
  addressFromParts,
  deriveSpendKey,
  digestToBytes,
  encodeHexLower,
  encodeZkAddress,
  generateMnemonic,
  mnemonicFromEntropy,
  nkCommit,
  seedFromMnemonicV1,
  validateMnemonic,
  ZKCOINS_PURPOSE,
  type SpendKey,
} from '@zkcoins/sdk';

/** Hardened NK branch under account root A (§1.2 / D10): `A/3'`. */
const NK_BRANCH = 3;

export interface V1AccountKeys {
  /** Bech32m `zk1…` subject. */
  address: string;
  /** BIP-39 English mnemonic (12 words). */
  mnemonic: string;
  /** 32-byte `nk_commit` as lowercase hex (bound into the address). */
  nkCommit: string;
  /** sk₀ public key (x-only), lowercase hex — identity key. */
  pk0: string;
}

function requireNonNegInt(n: number, label: string): number {
  if (!Number.isInteger(n) || n < 0 || n > 0x7fffffff) {
    throw new Error(`${label}: expected integer in [0, 2^31-1], got ${String(n)}`);
  }
  return n;
}

/**
 * Derive the 32-byte nullifier key `nk = A/3'` = `m/1798'/account'/3'`.
 * `nk` itself stays out of the account record; only `nk_commit` is retained.
 */
export function deriveNk(seed: Uint8Array, account: number): Uint8Array {
  const acc = requireNonNegInt(account, 'account');
  const path = `m/${ZKCOINS_PURPOSE}'/${acc}'/${NK_BRANCH}'`;
  const master = HDKey.fromMasterSeed(seed);
  const child = master.derive(path);
  if (!child.privateKey) {
    throw new Error(`deriveNk: no private key at ${path}`);
  }
  return child.privateKey.slice();
}

/** Seed → sk₀ + nk_commit + Bech32m address for account index 0 by default. */
export function accountKeysFromSeed(
  seed: Uint8Array,
  accountIndex = 0,
): Omit<V1AccountKeys, 'mnemonic'> {
  const sk0 = deriveSpendKey(seed, accountIndex, 0);
  const nk = deriveNk(seed, accountIndex);
  const nkCommitBytes = digestToBytes(nkCommit(nk));
  const addressRaw = addressFromParts(sk0.publicKey, nkCommitBytes);
  return {
    address: encodeZkAddress(addressRaw),
    nkCommit: encodeHexLower(nkCommitBytes),
    pk0: encodeHexLower(sk0.publicKey),
  };
}

/** Fresh BIP-39 mnemonic (12 words, CSPRNG). */
export async function createMnemonic(): Promise<string> {
  return generateMnemonic();
}

/** Validate BIP-39 English mnemonic. */
export async function isValidMnemonic(phrase: string): Promise<boolean> {
  return validateMnemonic(phrase);
}

/** Deterministic BIP-39 from 16-byte entropy hex (passkey-PRF path). */
export async function mnemonicFromEntropyHex(entropyHex: string): Promise<string> {
  return mnemonicFromEntropy(entropyHex);
}

/** Full account keys from a BIP-39 mnemonic (empty passphrase only in v1). */
export function accountKeysFromMnemonic(mnemonic: string, accountIndex = 0): V1AccountKeys {
  const seed = seedFromMnemonicV1(mnemonic);
  const keys = accountKeysFromSeed(seed, accountIndex);
  return { ...keys, mnemonic: mnemonic.trim() };
}

/** SPEND child `skᵢ` for the transition at `send_counter = index`. */
export function spendKeyAt(mnemonic: string, index: number, accountIndex = 0): SpendKey {
  const seed = seedFromMnemonicV1(mnemonic);
  return deriveSpendKey(seed, accountIndex, index);
}

/** BIP-39 → 64-byte seed (v1 empty-passphrase). */
export function seedFromAccountMnemonic(mnemonic: string): Uint8Array {
  return seedFromMnemonicV1(mnemonic);
}
