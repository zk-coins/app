import { describe, it, expect } from 'vitest';
import { deriveMnemonicFromPrf, DERIVATION_VERSION } from '@/lib/crypto/key-derivation';

describe('key-derivation', () => {
  it('exports derivation version v1', () => {
    expect(DERIVATION_VERSION).toBe('v1');
  });

  it('derives a mnemonic from PRF output', async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const mnemonic = await deriveMnemonicFromPrf(prfOutput);
    expect(typeof mnemonic).toBe('string');
    // The mock WASM returns the test mnemonic
    expect(mnemonic.split(' ')).toHaveLength(12);
  });

  it('produces deterministic mnemonic from same PRF', async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const mnemonic1 = await deriveMnemonicFromPrf(prfOutput);
    const mnemonic2 = await deriveMnemonicFromPrf(prfOutput);
    expect(mnemonic1).toBe(mnemonic2);
  });

  it('calls WASM mnemonicFromEntropy with hex string', async () => {
    const { initWasm } = await import('@zkcoins/wasm');
    const wasm = await initWasm();

    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    await deriveMnemonicFromPrf(prfOutput);

    expect(wasm.mnemonicFromEntropy).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{32}$/));
  });
});
