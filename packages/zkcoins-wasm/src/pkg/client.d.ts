/* tslint:disable */
/* eslint-disable */
/**
 * Convert hex-encoded entropy (16 bytes = 128 bits) to a BIP-39 mnemonic.
 * Used for deterministic mnemonic derivation from HKDF output (passkey flow).
 * @param {string} entropy_hex
 * @returns {string}
 */
export function mnemonic_from_entropy(entropy_hex: string): string;
/**
 * Generate a new BIP-39 mnemonic (12 words).
 * Returns the mnemonic phrase as a string.
 * @returns {string}
 */
export function generate_mnemonic(): string;
/**
 * Derive the current and next compressed public keys for a send transaction.
 * Returns JSON: { public_key, next_public_key } (hex-encoded compressed SEC1)
 * @param {string} xpriv_str
 * @param {number} num_pubkeys
 * @returns {string}
 */
export function derive_public_keys(xpriv_str: string, num_pubkeys: number): string;
/**
 * Derive the raw 32-byte private key at a given BIP32 index.
 * Returns hex-encoded private key bytes for use with sign_schnorr.
 * @param {string} xpriv_str
 * @param {number} index
 * @returns {string}
 */
export function derive_signing_key(xpriv_str: string, index: number): string;
/**
 * Validate a BIP-39 mnemonic phrase.
 * Returns true if the phrase is valid.
 * @param {string} phrase
 * @returns {boolean}
 */
export function validate_mnemonic(phrase: string): boolean;
/**
 * Generate a new HD wallet: master xpriv, derived address, initial pubkey count.
 * Returns JSON: { address_hex, num_pubkeys, xpriv_str }
 * @returns {string}
 */
export function generate_account_keys(): string;
/**
 * Sign a 32-byte hash with a Schnorr signature.
 * Both inputs are hex-encoded 32-byte strings.
 * Returns hex-encoded Schnorr signature.
 * @param {string} private_key_hex
 * @param {string} hash_hex
 * @returns {string}
 */
export function sign_schnorr(private_key_hex: string, hash_hex: string): string;
/**
 * Generate account keys from a BIP-39 mnemonic phrase.
 * Returns JSON: { address_hex, num_pubkeys, xpriv_str }
 * @param {string} mnemonic_phrase
 * @param {string} passphrase
 * @returns {string}
 */
export function generate_account_keys_from_mnemonic(mnemonic_phrase: string, passphrase: string): string;
/**
 * Create a commitment for the two-phase send flow.
 * Takes the proof data (account_state_hash + output_coins_root as hex) and the signing key index.
 * Returns JSON: { public_key, signature, message } (all hex-encoded).
 * @param {string} xpriv_str
 * @param {number} num_pubkeys
 * @param {string} account_state_hash_hex
 * @param {string} output_coins_root_hex
 * @returns {string}
 */
export function create_commitment(xpriv_str: string, num_pubkeys: number, account_state_hash_hex: string, output_coins_root_hex: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly create_commitment: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => Array;
  readonly derive_public_keys: (a: number, b: number, c: number) => Array;
  readonly derive_signing_key: (a: number, b: number, c: number) => Array;
  readonly generate_account_keys: () => Array;
  readonly generate_account_keys_from_mnemonic: (a: number, b: number, c: number, d: number) => Array;
  readonly generate_mnemonic: () => Array;
  readonly mnemonic_from_entropy: (a: number, b: number) => Array;
  readonly sign_schnorr: (a: number, b: number, c: number, d: number) => Array;
  readonly validate_mnemonic: (a: number, b: number) => number;
  readonly rustsecp256k1_v0_10_0_context_create: (a: number) => number;
  readonly rustsecp256k1_v0_10_0_context_destroy: (a: number) => void;
  readonly rustsecp256k1_v0_10_0_default_error_callback_fn: (a: number, b: number) => void;
  readonly rustsecp256k1_v0_10_0_default_illegal_callback_fn: (a: number, b: number) => void;
  readonly __wbindgen_export_0: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
