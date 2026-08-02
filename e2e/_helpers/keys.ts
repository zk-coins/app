/**
 * Node-side v1 key helpers for the E2E harness.
 *
 * Replaces the deleted in-tree WASM package. Derives the same Bech32m
 * subject + nk_commit the app onboarding path produces via `@zkcoins/sdk`.
 */

import { HDKey } from '@scure/bip32';
import {
  addressFromParts,
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

/** Derive v1 account keys from a BIP-39 mnemonic (empty passphrase). */
export function accountFromMnemonic(mnemonic: string, accountIndex = 0): E2eAccountKeys {
  const seed = seedFromMnemonicV1(mnemonic);
  const sk0 = deriveSpendKey(seed, accountIndex, 0);
  const nk = deriveNk(seed, accountIndex);
  const nkCommitBytes = digestToBytes(nkCommit(nk));
  const addressRaw = addressFromParts(sk0.publicKey, nkCommitBytes);
  return {
    address: encodeZkAddress(addressRaw),
    mnemonic: mnemonic.trim(),
    nkCommit: encodeHexLower(nkCommitBytes),
    pk0: encodeHexLower(sk0.publicKey),
  };
}
