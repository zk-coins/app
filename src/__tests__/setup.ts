import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { vi, beforeEach } from 'vitest';
import { createMockWasm } from './_mocks/wasm';

// Fresh IndexedDB for every test (avoids open connection blocking deleteDatabase)
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

// Mock @zkcoins/wasm globally — tests that need real WASM use Playwright E2E.
// The factory is typed as `ZkCoinsWasm` so any drift between the real
// interface and the fake fails the TS build instead of silently passing.
vi.mock('@zkcoins/wasm', () => ({
  initWasm: vi.fn().mockResolvedValue(createMockWasm()),
}));
