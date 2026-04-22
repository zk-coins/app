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

  if (typeof window !== 'undefined') {
    try {
      const wasm = await import('./pkg/client');
      await wasm.default();
      wasmModule = {
        isWasm: true,
        createAccount: async () => {
          const resultJson = await wasm.create_and_store_new_account();
          return JSON.parse(resultJson);
        },
        signSchnorr: (privateKeyHex: string, hashHex: string) => {
          return wasm.sign_schnorr(privateKeyHex, hashHex);
        },
        sendCoins: async (senderHex: string, recipientHex: string, amount: string) => {
          return wasm.send_coins_from_browser(senderHex, recipientHex, amount);
        },
      };
      return wasmModule;
    } catch {
      // WASM load failed, use fallback
    }
  }

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
