import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { IDBFactory } from 'fake-indexeddb';
import { vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { createMockWasm } from './_mocks/wasm';

// Some happy-dom builds do not expose a `localStorage` Storage instance on
// the window by default. The app (and several tests) treat
// `window.localStorage` as always-present (it is, in every real browser),
// so provide a minimal in-memory Storage shim when it is missing. This is
// purely additive: when the environment already supplies `localStorage`
// (CI, newer happy-dom) this guard is a no-op.
if (typeof globalThis.localStorage === 'undefined') {
  const makeStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      removeItem: (k: string) => void map.delete(k),
      setItem: (k: string, v: string) => void map.set(k, String(v)),
    } as Storage;
  };
  const storage = makeStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  }
}

// Fresh IndexedDB for every test (avoids open connection blocking deleteDatabase)
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

// Unmount any React tree rendered through @testing-library/react. Without
// this, queries in the next test see leftover nodes and `getByTestId`
// throws `Found multiple elements`. testing-library auto-registers this
// when running under vitest's `globals: true`, which we don't set.
afterEach(() => {
  cleanup();
});

// Mock @zkcoins/wasm globally — tests that need real WASM use Playwright E2E.
// The factory is typed as `ZkCoinsWasm` so any drift between the real
// interface and the fake fails the TS build instead of silently passing.
vi.mock('@zkcoins/wasm', () => ({
  initWasm: vi.fn().mockResolvedValue(createMockWasm()),
}));
