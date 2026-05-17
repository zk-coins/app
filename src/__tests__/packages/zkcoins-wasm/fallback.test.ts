/**
 * JS-fallback path of `packages/zkcoins-wasm/src/index.ts`.
 *
 * Every other unit test sees `@zkcoins/wasm` through the typed in-memory
 * fake registered in `src/__tests__/setup.ts`. Here we deliberately
 * bypass that fake with `vi.importActual` so the real `initWasm()`
 * runs. The wasm-bindgen client (`./pkg/client.js`) loads
 * `client_bg.wasm` via `fetch(new URL(..., import.meta.url))` — a
 * `file://` fetch is unsupported in happy-dom, so `await wasm.default()`
 * rejects and `initWasm()` returns `createJsFallback()`.
 *
 * Each fallback method is asserted to throw the WASM_REQUIRED message
 * (rather than returning `undefined`) so callers like SendPage or
 * Onboarding surface the reload prompt instead of crashing further
 * downstream.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ZkCoinsWasm } from '@zkcoins/wasm';

const WASM_REQUIRED_RX = /Cryptography module failed to load/;

/**
 * Reset the module cache, then re-import the real module past the
 * setup-file mock. Resetting modules also resets the `wasmModule`
 * singleton declared at the top of `index.ts` so each test sees a
 * fresh init.
 */
async function freshInitWasm(): Promise<typeof import('@zkcoins/wasm').initWasm> {
  vi.resetModules();
  const actual = await vi.importActual<typeof import('@zkcoins/wasm')>('@zkcoins/wasm');
  return actual.initWasm;
}

describe('@zkcoins/wasm — JS fallback when the WASM module cannot load', () => {
  let wasm: ZkCoinsWasm;

  beforeEach(async () => {
    const initWasm = await freshInitWasm();
    wasm = await initWasm();
  });

  it('marks itself as the JS fallback (isWasm=false)', () => {
    expect(wasm.isWasm).toBe(false);
  });

  it('throws WASM_REQUIRED on createAccount', async () => {
    await expect(wasm.createAccount()).rejects.toThrow(WASM_REQUIRED_RX);
  });

  it('throws WASM_REQUIRED on createAccountFromMnemonic', async () => {
    await expect(wasm.createAccountFromMnemonic('any phrase')).rejects.toThrow(WASM_REQUIRED_RX);
  });

  it('throws WASM_REQUIRED on generateMnemonic', () => {
    expect(() => wasm.generateMnemonic()).toThrow(WASM_REQUIRED_RX);
  });

  it('throws WASM_REQUIRED on validateMnemonic', () => {
    expect(() => wasm.validateMnemonic('any')).toThrow(WASM_REQUIRED_RX);
  });

  it('throws WASM_REQUIRED on mnemonicFromEntropy', () => {
    expect(() => wasm.mnemonicFromEntropy('00'.repeat(16))).toThrow(WASM_REQUIRED_RX);
  });

  it('throws WASM_REQUIRED on deriveSigningKey', () => {
    expect(() => wasm.deriveSigningKey('xpriv', 0)).toThrow(WASM_REQUIRED_RX);
  });

  it('throws WASM_REQUIRED on signSchnorr', () => {
    expect(() => wasm.signSchnorr('priv', 'hash')).toThrow(WASM_REQUIRED_RX);
  });

  it('throws WASM_REQUIRED on derivePublicKeys', () => {
    expect(() => wasm.derivePublicKeys('xpriv', 0)).toThrow(WASM_REQUIRED_RX);
  });

  it('throws WASM_REQUIRED on createCommitment', () => {
    expect(() => wasm.createCommitment('xpriv', 0, 'ash', 'ocr')).toThrow(WASM_REQUIRED_RX);
  });
});

describe('@zkcoins/wasm — initWasm singleton', () => {
  it('returns the same instance on repeated calls within a session', async () => {
    const initWasm = await freshInitWasm();
    const first = await initWasm();
    const second = await initWasm();
    expect(second).toBe(first);
  });

  it('produces a fresh instance after the module cache is reset', async () => {
    const initWasm1 = await freshInitWasm();
    const a = await initWasm1();
    const initWasm2 = await freshInitWasm();
    const b = await initWasm2();
    // Different module evaluations → different fallback objects.
    expect(b).not.toBe(a);
    expect(a.isWasm).toBe(false);
    expect(b.isWasm).toBe(false);
  });
});
