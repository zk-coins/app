/**
 * Node-side v1 key helpers for the E2E harness.
 *
 * Replaces the deleted in-tree WASM package. Derives the same Bech32m
 * subject + nk_commit the app onboarding path produces via `@zkcoins/sdk`.
 */

import { HDKey } from '@scure/bip32';
import {
  addressFromParts,
  bip340NormaliseSecret,
  deriveSpendKey,
  digestToBytes,
  encodeHexLower,
  encodeZkAddress,
  nkCommit,
  seedFromMnemonicV1,
  ZKCOINS_PURPOSE,
} from '@zkcoins/sdk';

const NK_BRANCH = 3;

export interface E2eAccountKeys {
  address: string;
  mnemonic: string;
  nkCommit: string;
  pk0: string;
  /** Raw 32-byte ivk secret (A/1'/0'). */
  ivk: Uint8Array;
  /** BIP-340 x-only IVPK. */
  ivpk: Uint8Array;
  /** Raw 32-byte op secret (A/2'). */
  op: Uint8Array;
  /** Raw 32-byte ovk (A/1'/1'). */
  ovk: Uint8Array;
  /** Raw 32-byte op_secret (A/4'). */
  opSecret: Uint8Array;
  /** Raw 32-byte nk (A/3'). */
  nk: Uint8Array;
}

function deriveNk(seed: Uint8Array, account: number): Uint8Array {
  const path = `m/${ZKCOINS_PURPOSE}'/${account}'/${NK_BRANCH}'`;
  const master = HDKey.fromMasterSeed(seed);
  const child = master.derive(path);
  if (!child.privateKey) {
    throw new Error(`e2e keys: no private key at ${path}`);
  }
  return child.privateKey.slice();
}

function deriveBranch(seed: Uint8Array, account: number, pathSuffix: string): Uint8Array {
  const path = `m/${ZKCOINS_PURPOSE}'/${account}'/${pathSuffix}`;
  const master = HDKey.fromMasterSeed(seed);
  const child = master.derive(path);
  if (!child.privateKey) {
    throw new Error(`e2e keys: no private key at ${path}`);
  }
  return child.privateKey.slice();
}

/** Derive v1 account keys from a BIP-39 mnemonic (empty passphrase). */
export function accountFromMnemonic(mnemonic: string, accountIndex = 0): E2eAccountKeys {
  const seed = seedFromMnemonicV1(mnemonic);
  const sk0 = deriveSpendKey(seed, accountIndex, 0);
  const nk = deriveNk(seed, accountIndex);
  const ivk = deriveBranch(seed, accountIndex, "1'/0'");
  const ovk = deriveBranch(seed, accountIndex, "1'/1'");
  const op = deriveBranch(seed, accountIndex, "2'");
  const opSecret = deriveBranch(seed, accountIndex, "4'");
  const nkCommitBytes = digestToBytes(nkCommit(nk));
  const addressRaw = addressFromParts(sk0.publicKey, nkCommitBytes);
  return {
    address: encodeZkAddress(addressRaw),
    mnemonic: mnemonic.trim(),
    nkCommit: encodeHexLower(nkCommitBytes),
    pk0: encodeHexLower(sk0.publicKey),
    ivk,
    ivpk: bip340NormaliseSecret(ivk).pkBytes,
    op,
    ovk,
    opSecret,
    nk,
  };
}

/** §7.7 operational bundle (version 0x01 ‖ ivk ‖ ovk ‖ op ‖ nk ‖ op_secret). */
export function operationalBundleHex(keys: E2eAccountKeys): string {
  const bundle = new Uint8Array(161);
  bundle[0] = 0x01;
  bundle.set(keys.ivk, 1);
  bundle.set(keys.ovk, 33);
  bundle.set(keys.op, 65);
  bundle.set(keys.nk, 97);
  bundle.set(keys.opSecret, 129);
  return encodeHexLower(bundle);
}
