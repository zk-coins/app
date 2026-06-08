/**
 * Node-side loader for the app's `@zkcoins/wasm` crypto module.
 *
 * The browser bundle initialises the wasm via `fetch(new URL('client_bg.wasm',
 * import.meta.url))` — which does not work under Node (no `fetch` of a
 * `file://` URL). The E2E harness runs in Node, so we initialise the SAME
 * compiled module directly from its bytes on disk and expose the exact subset
 * of functions the harness needs.
 *
 * Using the wasm path here (rather than `@zkcoins/sdk`'s independent crypto)
 * is load-bearing, not cosmetic: the node credits a minted asset to
 * `owner = Poseidon(creator_pubkey)` and serves the portfolio under that
 * Poseidon address. The wallet derives its address the same way
 * (`address_hex = H(pubkey_0)` via the Rust `shared` crate's Poseidon `hash`),
 * so the harness MUST derive the fixture address through the wasm to poll the
 * address the node actually credits — the SDK's `sha256(pubkey_0)` address is
 * a different, unobserved value.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';

/** The thin slice of the wasm API the harness exercises. */
export interface E2eWasm {
  /** `{ address_hex, num_pubkeys, xpriv_str }` for a BIP-39 mnemonic. */
  account(mnemonic: string): { address: string; xpriv: string; numPubkeys: number };
  /** Compressed pubkey at `index` (+ the rotation key at `index+1`). */
  publicKeys(xpriv: string, index: number): { publicKey: string; nextPublicKey: string };
  /** Raw 32-byte signing key at `index`, hex. */
  signingKey(xpriv: string, index: number): string;
  /** BIP-340 Schnorr over a 32-byte hex digest. */
  sign(privateKeyHex: string, hashHex: string): string;
  /** Commitment `{ public_key, signature, message }` for the two-phase flow. */
  commitment(
    xpriv: string,
    index: number,
    accountStateHash: string,
    outputCoinsRoot: string,
  ): { publicKey: string; signature: string; message: string };
}

const PKG_DIR = path.resolve(__dirname, '..', '..', 'packages', 'zkcoins-wasm', 'src', 'pkg');

let cached: E2eWasm | null = null;

/** Initialise (once) and return the Node-bound wasm helper. */
export async function loadWasm(): Promise<E2eWasm> {
  if (cached) return cached;

  // The pkg is an ESM module that ships its own `.wasm` next to `client.js`.
  // `pathToFileURL` keeps this working regardless of the cwd Playwright runs in.
  const wasm = await import(pathToFileURL(path.join(PKG_DIR, 'client.js')).href);
  const bytes = readFileSync(path.join(PKG_DIR, 'client_bg.wasm'));
  await wasm.default({ module_or_path: bytes });

  cached = {
    account: (mnemonic: string) => {
      const data = JSON.parse(wasm.generate_account_keys_from_mnemonic(mnemonic, ''));
      return {
        address: data.address_hex as string,
        xpriv: data.xpriv_str as string,
        numPubkeys: data.num_pubkeys as number,
      };
    },
    publicKeys: (xpriv: string, index: number) => {
      const data = JSON.parse(wasm.derive_public_keys(xpriv, index));
      return { publicKey: data.public_key as string, nextPublicKey: data.next_public_key as string };
    },
    signingKey: (xpriv: string, index: number) => wasm.derive_signing_key(xpriv, index) as string,
    sign: (privateKeyHex: string, hashHex: string) =>
      wasm.sign_schnorr(privateKeyHex, hashHex) as string,
    commitment: (xpriv, index, accountStateHash, outputCoinsRoot) => {
      const data = JSON.parse(
        wasm.create_commitment(xpriv, index, accountStateHash, outputCoinsRoot),
      );
      return {
        publicKey: data.public_key as string,
        signature: data.signature as string,
        message: data.message as string,
      };
    },
  };
  return cached;
}
