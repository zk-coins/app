import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Some happy-dom builds do not expose a Storage instance on the window by
// default. Provide a minimal in-memory Storage shim when it is missing.
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

if (typeof globalThis.localStorage === 'undefined') {
  const storage = makeStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  }
}

if (typeof globalThis.sessionStorage === 'undefined') {
  const storage = makeStorage();
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'sessionStorage', { value: storage, configurable: true });
  }
}

const realFetch = globalThis.fetch.bind(globalThis);

// Fresh IndexedDB for every test
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/v1/bootstrap/challenge')) {
        return new Response(
          JSON.stringify({
            nonce: 'aa'.repeat(32),
            expiry: String(Math.floor(Date.now() / 1000) + 300),
            domain: 'zkCoins/v1/EntrustChallenge',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/v1/bootstrap/entrust')) {
        return new Response('{}', { status: 409 });
      }
      return realFetch(input, init);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
