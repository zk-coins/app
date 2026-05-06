use bitcoin::{
    bip32::Xpriv,
    key::Secp256k1,
    secp256k1::{Message, SecretKey},
};
use core::str::FromStr;
use serde::{Deserialize, Serialize};
use shared::{ClientAccount, new_master_private_key, master_private_key_from_seed};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize)]
struct AccountKeys {
    address_hex: String,
    num_pubkeys: u32,
    xpriv_str: String,
}

#[derive(Serialize)]
struct PublicKeyPair {
    public_key: String,
    next_public_key: String,
}

/// Generate a new HD wallet: master xpriv, derived address, initial pubkey count.
/// Returns JSON: { address_hex, num_pubkeys, xpriv_str }
#[wasm_bindgen]
pub fn generate_account_keys() -> Result<String, JsValue> {
    let master_xpriv = new_master_private_key();
    let client_account = ClientAccount::new(master_xpriv);

    let data = AccountKeys {
        address_hex: hex::encode(client_account.address),
        num_pubkeys: 0,
        xpriv_str: client_account.private_key.to_string(),
    };

    serde_json::to_string(&data)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize: {}", e)))
}

/// Derive the current and next compressed public keys for a send transaction.
/// Returns JSON: { public_key, next_public_key } (hex-encoded compressed SEC1)
#[wasm_bindgen]
pub fn derive_public_keys(xpriv_str: &str, num_pubkeys: u32) -> Result<String, JsValue> {
    let xpriv = Xpriv::from_str(xpriv_str)
        .map_err(|e| JsValue::from_str(&format!("Invalid xpriv: {}", e)))?;

    let client_account = ClientAccount {
        address: [0u8; 32],
        num_pubkeys,
        private_key: xpriv,
    };

    let public_key = client_account.generate_public_key(num_pubkeys);
    let next_public_key = client_account.generate_public_key(num_pubkeys + 1);

    let result = PublicKeyPair {
        public_key: hex::encode(public_key.serialize()),
        next_public_key: hex::encode(next_public_key.serialize()),
    };

    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize: {}", e)))
}

/// Generate a new BIP-39 mnemonic (12 words).
/// Returns the mnemonic phrase as a string.
#[wasm_bindgen]
pub fn generate_mnemonic() -> Result<String, JsValue> {
    let mnemonic = shared::generate_mnemonic();
    Ok(mnemonic.to_string())
}

/// Validate a BIP-39 mnemonic phrase.
/// Returns true if the phrase is valid.
#[wasm_bindgen]
pub fn validate_mnemonic(phrase: &str) -> bool {
    shared::validate_mnemonic(phrase)
}

/// Generate account keys from a BIP-39 mnemonic phrase.
/// Returns JSON: { address_hex, num_pubkeys, xpriv_str }
#[wasm_bindgen]
pub fn generate_account_keys_from_mnemonic(mnemonic_phrase: &str, passphrase: &str) -> Result<String, JsValue> {
    let mnemonic: bip39::Mnemonic = mnemonic_phrase.parse()
        .map_err(|e: bip39::Error| JsValue::from_str(&format!("Invalid mnemonic: {}", e)))?;

    let seed = shared::mnemonic_to_seed(&mnemonic, passphrase);
    let master_xpriv = master_private_key_from_seed(&seed);
    let client_account = ClientAccount::new(master_xpriv);

    let data = AccountKeys {
        address_hex: hex::encode(client_account.address),
        num_pubkeys: 0,
        xpriv_str: client_account.private_key.to_string(),
    };

    serde_json::to_string(&data)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize: {}", e)))
}

/// Convert hex-encoded entropy (16 bytes = 128 bits) to a BIP-39 mnemonic.
/// Used for deterministic mnemonic derivation from HKDF output (passkey flow).
#[wasm_bindgen]
pub fn mnemonic_from_entropy(entropy_hex: &str) -> Result<String, JsValue> {
    let entropy = hex::decode(entropy_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hex entropy: {}", e)))?;
    let mnemonic = bip39::Mnemonic::from_entropy(&entropy)
        .map_err(|e| JsValue::from_str(&format!("Invalid entropy for BIP-39: {}", e)))?;
    Ok(mnemonic.to_string())
}

/// Sign a 32-byte hash with a Schnorr signature.
/// Both inputs are hex-encoded 32-byte strings.
/// Returns hex-encoded Schnorr signature.
#[wasm_bindgen]
pub fn sign_schnorr(private_key_hex: &str, hash_hex: &str) -> Result<String, JsValue> {
    let priv_key_bytes = hex::decode(private_key_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hex in private key: {}", e)))?;
    if priv_key_bytes.len() != 32 {
        return Err(JsValue::from_str("Private key must be 32 bytes in hex"));
    }

    let secret_key = SecretKey::from_slice(&priv_key_bytes)
        .map_err(|e| JsValue::from_str(&format!("Invalid secret key: {}", e)))?;

    let hash_bytes = hex::decode(hash_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hex in message hash: {}", e)))?;
    if hash_bytes.len() != 32 {
        return Err(JsValue::from_str("Hash must be 32 bytes in hex"));
    }

    let msg = Message::from_digest_slice(&hash_bytes)
        .map_err(|e| JsValue::from_str(&format!("Invalid message: {}", e)))?;

    let secp = Secp256k1::signing_only();
    let keypair = bitcoin::secp256k1::Keypair::from_secret_key(&secp, &secret_key);
    let sig = secp.sign_schnorr_no_aux_rand(&msg, &keypair);

    Ok(hex::encode(sig.as_ref()))
}
