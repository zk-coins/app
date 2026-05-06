/**
 * @zkcoins/wasm — TypeScript wrapper for the Rust WASM crypto module.
 *
 * Provides HD wallet creation, BIP-39 mnemonics, Schnorr signing,
 * and public key derivation via the compiled Rust WASM module.
 * Falls back to JS crypto for account creation if WASM is unavailable.
 */

export interface AccountData {
  address: string;
  xpriv: string;
  numPubkeys: number;
}

export interface PublicKeys {
  publicKey: string;
  nextPublicKey: string;
}

export interface ZkCoinsWasm {
  createAccount(): Promise<AccountData>;
  createAccountFromMnemonic(mnemonic: string, passphrase?: string): Promise<AccountData>;
  generateMnemonic(): string;
  validateMnemonic(phrase: string): boolean;
  signSchnorr(privateKeyHex: string, hashHex: string): string;
  derivePublicKeys(xpriv: string, numPubkeys: number): PublicKeys;
  isWasm: boolean;
}

let wasmModule: ZkCoinsWasm | null = null;

export async function initWasm(): Promise<ZkCoinsWasm> {
  if (wasmModule) return wasmModule;

  try {
    const wasm = await import('./pkg/client.js');
    await wasm.default();

    wasmModule = {
      isWasm: true,
      createAccount: async () => {
        const json = wasm.generate_account_keys();
        const data = JSON.parse(json);
        return {
          address: data.address_hex,
          xpriv: data.xpriv_str,
          numPubkeys: data.num_pubkeys,
        };
      },
      createAccountFromMnemonic: async (mnemonic: string, passphrase = '') => {
        const json = wasm.generate_account_keys_from_mnemonic(mnemonic, passphrase);
        const data = JSON.parse(json);
        return {
          address: data.address_hex,
          xpriv: data.xpriv_str,
          numPubkeys: data.num_pubkeys,
        };
      },
      generateMnemonic: () => wasm.generate_mnemonic(),
      validateMnemonic: (phrase: string) => wasm.validate_mnemonic(phrase),
      signSchnorr: (privateKeyHex: string, hashHex: string) =>
        wasm.sign_schnorr(privateKeyHex, hashHex),
      derivePublicKeys: (xpriv: string, numPubkeys: number) => {
        const json = wasm.derive_public_keys(xpriv, numPubkeys);
        const data = JSON.parse(json);
        return {
          publicKey: data.public_key,
          nextPublicKey: data.next_public_key,
        };
      },
    };
  } catch {
    wasmModule = createJsFallback();
  }

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
    createAccountFromMnemonic: async () => {
      throw new Error('Mnemonic account creation requires WASM module');
    },
    generateMnemonic: () => {
      throw new Error('Mnemonic generation requires WASM module');
    },
    validateMnemonic: () => {
      throw new Error('Mnemonic validation requires WASM module');
    },
    signSchnorr: () => {
      throw new Error('Schnorr signing requires WASM module');
    },
    derivePublicKeys: () => {
      throw new Error('Public key derivation requires WASM module');
    },
  };
}
