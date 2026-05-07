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

export interface CommitmentData {
  publicKey: string;
  signature: string;
  message: string;
}

export interface ZkCoinsWasm {
  createAccount(): Promise<AccountData>;
  createAccountFromMnemonic(mnemonic: string, passphrase?: string): Promise<AccountData>;
  generateMnemonic(): string;
  validateMnemonic(phrase: string): boolean;
  mnemonicFromEntropy(entropyHex: string): string;
  deriveSigningKey(xpriv: string, index: number): string;
  signSchnorr(privateKeyHex: string, hashHex: string): string;
  derivePublicKeys(xpriv: string, numPubkeys: number): PublicKeys;
  createCommitment(
    xpriv: string,
    numPubkeys: number,
    accountStateHash: string,
    outputCoinsRoot: string,
  ): CommitmentData;
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
      mnemonicFromEntropy: (entropyHex: string) => wasm.mnemonic_from_entropy(entropyHex),
      deriveSigningKey: (xpriv: string, index: number) => wasm.derive_signing_key(xpriv, index),
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
      createCommitment: (
        xpriv: string,
        numPubkeys: number,
        accountStateHash: string,
        outputCoinsRoot: string,
      ) => {
        const json = wasm.create_commitment(xpriv, numPubkeys, accountStateHash, outputCoinsRoot);
        const data = JSON.parse(json);
        return {
          publicKey: data.public_key,
          signature: data.signature,
          message: data.message,
        };
      },
    };
  } catch {
    wasmModule = createJsFallback();
  }

  return wasmModule;
}

const WASM_REQUIRED =
  'Cryptography module failed to load — please reload the page or use a modern browser.';

function createJsFallback(): ZkCoinsWasm {
  return {
    isWasm: false,
    createAccount: async () => {
      throw new Error(WASM_REQUIRED);
    },
    createAccountFromMnemonic: async () => {
      throw new Error(WASM_REQUIRED);
    },
    generateMnemonic: () => {
      throw new Error(WASM_REQUIRED);
    },
    validateMnemonic: () => {
      throw new Error(WASM_REQUIRED);
    },
    mnemonicFromEntropy: () => {
      throw new Error(WASM_REQUIRED);
    },
    deriveSigningKey: () => {
      throw new Error(WASM_REQUIRED);
    },
    signSchnorr: () => {
      throw new Error(WASM_REQUIRED);
    },
    derivePublicKeys: () => {
      throw new Error(WASM_REQUIRED);
    },
    createCommitment: () => {
      throw new Error(WASM_REQUIRED);
    },
  };
}
