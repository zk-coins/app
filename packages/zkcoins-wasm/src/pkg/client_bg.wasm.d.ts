/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export function derive_public_keys(a: number, b: number, c: number): Array;
export function generate_account_keys(): Array;
export function generate_account_keys_from_mnemonic(a: number, b: number, c: number, d: number): Array;
export function generate_mnemonic(): Array;
export function mnemonic_from_entropy(a: number, b: number): Array;
export function sign_schnorr(a: number, b: number, c: number, d: number): Array;
export function validate_mnemonic(a: number, b: number): number;
export function rustsecp256k1_v0_10_0_context_create(a: number): number;
export function rustsecp256k1_v0_10_0_context_destroy(a: number): void;
export function rustsecp256k1_v0_10_0_default_error_callback_fn(a: number, b: number): void;
export function rustsecp256k1_v0_10_0_default_illegal_callback_fn(a: number, b: number): void;
export const __wbindgen_export_0: WebAssembly.Table;
export function __externref_table_dealloc(a: number): void;
export function __wbindgen_free(a: number, b: number, c: number): void;
export function __wbindgen_malloc(a: number, b: number): number;
export function __wbindgen_realloc(a: number, b: number, c: number, d: number): number;
export function __wbindgen_exn_store(a: number): void;
export function __externref_table_alloc(): number;
export function __wbindgen_start(): void;
