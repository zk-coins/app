import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { IDBFactory } from 'fake-indexeddb';
import { vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { createMockWasm } from './_mocks/wasm';

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
