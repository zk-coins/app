import { describe, it, expect } from 'vitest';
import { DERIVATION_VERSION, deriveMnemonicFromPrf } from '@/lib/crypto/key-derivation';
import { isValidMnemonic } from '@/lib/crypto/account-keys';

describe('deriveMnemonicFromPrf', () => {
  it('exports derivation version v1', () => {
    expect(DERIVATION_VERSION).toBe('v1');
  });

  it('derives a valid 12-word BIP-39 mnemonic from 32 PRF bytes', async () => {
    const prf = new Uint8Array(32);
    for (let i = 0; i < 32; i++) prf[i] = i + 1;
    const mnemonic = await deriveMnemonicFromPrf(prf);
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(await isValidMnemonic(mnemonic)).toBe(true);
  });

  it('is deterministic for the same PRF output', async () => {
    const prf = new Uint8Array(32).fill(7);
    const a = await deriveMnemonicFromPrf(prf);
    const b = await deriveMnemonicFromPrf(prf);
    expect(a).toBe(b);
  });
});
