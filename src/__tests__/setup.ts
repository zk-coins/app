import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { vi, beforeEach } from 'vitest';

// Fresh IndexedDB for every test (avoids open connection blocking deleteDatabase)
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

// Mock @zkcoins/wasm globally — tests that need real WASM use Playwright E2E
vi.mock('@zkcoins/wasm', () => ({
  initWasm: vi.fn().mockResolvedValue({
    isWasm: false,
    createAccount: vi.fn().mockResolvedValue({
      address: 'a'.repeat(64),
      xpriv: 'xprv9s21ZrQH143K3GJpoapnV8SFfuZcECe',
      numPubkeys: 0,
    }),
    createAccountFromMnemonic: vi.fn().mockResolvedValue({
      address: 'b'.repeat(64),
      xpriv: 'xprv9s21ZrQH143K3GJpoapnV8SFfuZcECe',
      numPubkeys: 0,
    }),
    generateMnemonic: vi
      .fn()
      .mockReturnValue(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      ),
    validateMnemonic: vi.fn().mockReturnValue(true),
    mnemonicFromEntropy: vi
      .fn()
      .mockReturnValue(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      ),
    deriveSigningKey: vi.fn().mockReturnValue('deadbeef'.repeat(8)),
    signSchnorr: vi.fn().mockReturnValue('cafebabe'.repeat(16)),
    derivePublicKeys: vi.fn().mockReturnValue({
      publicKey: '02' + 'aa'.repeat(32),
      nextPublicKey: '02' + 'bb'.repeat(32),
    }),
  }),
}));
