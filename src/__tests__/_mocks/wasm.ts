/**
 * Typed mock for `@zkcoins/wasm`.
 *
 * Typing the factory return as `ZkCoinsWasm` makes the TypeScript compiler
 * the contract enforcer between the real WASM surface (declared in
 * `packages/zkcoins-wasm/src/index.ts`) and the unit-test fake. When the
 * real interface gains, renames, or changes the signature of a method,
 * this file fails to compile — and so does the entire unit-test build.
 *
 * The previous untyped `vi.mock(() => ({ … }))` literal had already
 * drifted: it was missing `createCommitment`, which the real interface
 * has shipped with for a while. A typed factory makes that class of
 * drift impossible.
 *
 * Tests that need a per-test override can either mutate the returned
 * object before `initWasm` is awaited, or pass overrides into
 * `createMockWasm({ ... })`.
 */

import { vi } from 'vitest';
import type { ZkCoinsWasm } from '@zkcoins/wasm';

const FAKE_XPRIV = 'xprv9s21ZrQH143K3GJpoapnV8SFfuZcECe';
const FAKE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

export function createMockWasm(overrides: Partial<ZkCoinsWasm> = {}): ZkCoinsWasm {
  const base: ZkCoinsWasm = {
    isWasm: false,
    createAccount: vi.fn().mockResolvedValue({
      address: 'a'.repeat(64),
      xpriv: FAKE_XPRIV,
      numPubkeys: 0,
    }),
    createAccountFromMnemonic: vi.fn().mockResolvedValue({
      address: 'b'.repeat(64),
      xpriv: FAKE_XPRIV,
      numPubkeys: 0,
    }),
    generateMnemonic: vi.fn().mockReturnValue(FAKE_MNEMONIC),
    validateMnemonic: vi.fn().mockReturnValue(true),
    mnemonicFromEntropy: vi.fn().mockReturnValue(FAKE_MNEMONIC),
    deriveSigningKey: vi.fn().mockReturnValue('deadbeef'.repeat(8)),
    signSchnorr: vi.fn().mockReturnValue('cafebabe'.repeat(16)),
    derivePublicKeys: vi.fn().mockReturnValue({
      publicKey: '02' + 'aa'.repeat(32),
      nextPublicKey: '02' + 'bb'.repeat(32),
    }),
    createCommitment: vi.fn().mockReturnValue({
      publicKey: '02' + 'cc'.repeat(32),
      signature: 'dd'.repeat(64),
      message: 'ee'.repeat(32),
    }),
  };
  return { ...base, ...overrides };
}
