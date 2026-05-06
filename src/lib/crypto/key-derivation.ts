/**
 * Key derivation from PRF output to BIP-39 mnemonic.
 *
 * Adapted from DFX Wallet's key-derivation.ts:
 * PRF (32 bytes) → HKDF-SHA256 → 16 bytes entropy → BIP-39 (12 words)
 *
 * Uses Web Crypto API for HKDF (no external dependencies).
 */

import { initWasm } from '@zkcoins/wasm';

const HKDF_SALT = 'zkcoins-wallet-seed-derivation';
const HKDF_INFO = 'mnemonic-v1';

export const DERIVATION_VERSION = 'v1';

export async function deriveMnemonicFromPrf(prfOutput: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    prfOutput.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits'],
  );

  const salt = new TextEncoder().encode(HKDF_SALT);
  const info = new TextEncoder().encode(HKDF_INFO);

  // Derive 128 bits (16 bytes) for 12-word BIP-39
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    keyMaterial,
    128,
  );

  const entropy = new Uint8Array(derivedBits);
  const entropyHex = Array.from(entropy)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const wasm = await initWasm();
  return wasm.mnemonicFromEntropy(entropyHex);
}
