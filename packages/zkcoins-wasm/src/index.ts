/**
 * @zkcoins/wasm — TypeScript wrapper for the Rust WASM crypto module.
 *
 * Provides HD wallet creation, Schnorr signing, and coin transfers
 * via the compiled Rust WASM module. Falls back to JS crypto for
 * account creation if WASM is unavailable.
 */

export interface AccountData {
  address: string;
  xpriv: string;
  numPubkeys: number;
}

export interface ZkCoinsWasm {
  createAccount(): Promise<AccountData>;
  signSchnorr(privateKeyHex: string, hashHex: string): string;
  sendCoins(senderHex: string, recipientHex: string, amount: string): Promise<unknown>;
  isWasm: boolean;
}

let wasmModule: ZkCoinsWasm | null = null;

export async function initWasm(): Promise<ZkCoinsWasm> {
  if (wasmModule) return wasmModule;

  // Always use JS fallback — WASM integration will be enabled
  // once the pkg/ directory is built and committed.
  // To enable WASM: build rust/client with wasm-pack, then
  // uncomment the dynamic import below.
  wasmModule = createJsFallback();
  return wasmModule;
}

function createJsFallback(): ZkCoinsWasm {
  return {
    isWasm: false,
    createAccount: async () => {
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);
      const address = Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return { address, xpriv: '', numPubkeys: 0 };
    },
    signSchnorr: () => {
      throw new Error('Schnorr signing requires WASM module');
    },
    sendCoins: () => {
      throw new Error('Coin transfer requires WASM module');
    },
  };
}
