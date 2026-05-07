use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

const TEST_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

#[wasm_bindgen_test]
fn generate_account_keys_returns_valid_json() {
    let json = client::generate_account_keys().expect("generate_account_keys failed");
    let parsed: serde_json::Value = serde_json::from_str(&json).expect("invalid JSON");
    assert!(parsed["address_hex"].is_string());
    assert!(parsed["xpriv_str"].is_string());
    assert_eq!(parsed["num_pubkeys"], 0);
    // Address is 64-char hex (32 bytes)
    let addr = parsed["address_hex"].as_str().unwrap();
    assert_eq!(addr.len(), 64);
    assert!(addr.chars().all(|c| c.is_ascii_hexdigit()));
    // Xpriv starts with "xprv"
    let xpriv = parsed["xpriv_str"].as_str().unwrap();
    assert!(xpriv.starts_with("xprv"));
}

#[wasm_bindgen_test]
fn generate_account_keys_from_mnemonic_is_deterministic() {
    let json1 =
        client::generate_account_keys_from_mnemonic(TEST_MNEMONIC, "").expect("call 1 failed");
    let json2 =
        client::generate_account_keys_from_mnemonic(TEST_MNEMONIC, "").expect("call 2 failed");
    assert_eq!(json1, json2);
}

#[wasm_bindgen_test]
fn generate_account_keys_from_mnemonic_different_passphrase() {
    let json1 =
        client::generate_account_keys_from_mnemonic(TEST_MNEMONIC, "").expect("no passphrase");
    let json2 = client::generate_account_keys_from_mnemonic(TEST_MNEMONIC, "secret")
        .expect("with passphrase");
    assert_ne!(json1, json2);
}

#[wasm_bindgen_test]
fn generate_mnemonic_returns_12_words() {
    let phrase = client::generate_mnemonic().expect("generate_mnemonic failed");
    let words: Vec<&str> = phrase.split_whitespace().collect();
    assert_eq!(words.len(), 12);
}

#[wasm_bindgen_test]
fn generate_mnemonic_is_valid() {
    let phrase = client::generate_mnemonic().expect("generate_mnemonic failed");
    assert!(client::validate_mnemonic(&phrase));
}

#[wasm_bindgen_test]
fn validate_mnemonic_accepts_valid() {
    assert!(client::validate_mnemonic(TEST_MNEMONIC));
}

#[wasm_bindgen_test]
fn validate_mnemonic_rejects_invalid() {
    assert!(!client::validate_mnemonic("invalid mnemonic phrase"));
}

#[wasm_bindgen_test]
fn mnemonic_from_entropy_is_deterministic() {
    let entropy_hex = "00000000000000000000000000000000"; // 16 bytes
    let m1 = client::mnemonic_from_entropy(entropy_hex).expect("call 1 failed");
    let m2 = client::mnemonic_from_entropy(entropy_hex).expect("call 2 failed");
    assert_eq!(m1, m2);
    assert!(client::validate_mnemonic(&m1));
}

#[wasm_bindgen_test]
fn mnemonic_from_entropy_different_inputs() {
    let m1 = client::mnemonic_from_entropy("00000000000000000000000000000000").unwrap();
    let m2 = client::mnemonic_from_entropy("ffffffffffffffffffffffffffffffff").unwrap();
    assert_ne!(m1, m2);
}

#[wasm_bindgen_test]
fn derive_public_keys_returns_valid_hex() {
    let account_json =
        client::generate_account_keys_from_mnemonic(TEST_MNEMONIC, "").expect("account failed");
    let parsed: serde_json::Value = serde_json::from_str(&account_json).unwrap();
    let xpriv = parsed["xpriv_str"].as_str().unwrap();

    let keys_json = client::derive_public_keys(xpriv, 0).expect("derive_public_keys failed");
    let keys: serde_json::Value = serde_json::from_str(&keys_json).unwrap();

    let pk = keys["public_key"].as_str().unwrap();
    let npk = keys["next_public_key"].as_str().unwrap();
    // Compressed pubkey = 33 bytes = 66 hex chars
    assert_eq!(pk.len(), 66);
    assert_eq!(npk.len(), 66);
    assert_ne!(pk, npk);
    // Starts with 02 or 03
    assert!(pk.starts_with("02") || pk.starts_with("03"));
    assert!(npk.starts_with("02") || npk.starts_with("03"));
}

#[wasm_bindgen_test]
fn derive_signing_key_returns_32_byte_hex() {
    let account_json =
        client::generate_account_keys_from_mnemonic(TEST_MNEMONIC, "").expect("account failed");
    let parsed: serde_json::Value = serde_json::from_str(&account_json).unwrap();
    let xpriv = parsed["xpriv_str"].as_str().unwrap();

    let key_hex = client::derive_signing_key(xpriv, 0).expect("derive_signing_key failed");
    assert_eq!(key_hex.len(), 64); // 32 bytes = 64 hex chars
    assert!(key_hex.chars().all(|c| c.is_ascii_hexdigit()));
}

#[wasm_bindgen_test]
fn sign_schnorr_returns_valid_signature() {
    let account_json =
        client::generate_account_keys_from_mnemonic(TEST_MNEMONIC, "").expect("account failed");
    let parsed: serde_json::Value = serde_json::from_str(&account_json).unwrap();
    let xpriv = parsed["xpriv_str"].as_str().unwrap();

    let key_hex = client::derive_signing_key(xpriv, 0).expect("derive key failed");
    let hash_hex = "a".repeat(64); // 32-byte hash

    let sig = client::sign_schnorr(&key_hex, &hash_hex).expect("sign_schnorr failed");
    // Schnorr signature = 64 bytes = 128 hex chars
    assert_eq!(sig.len(), 128);
    assert!(sig.chars().all(|c| c.is_ascii_hexdigit()));
}

#[wasm_bindgen_test]
fn sign_schnorr_is_deterministic() {
    let account_json =
        client::generate_account_keys_from_mnemonic(TEST_MNEMONIC, "").expect("account failed");
    let parsed: serde_json::Value = serde_json::from_str(&account_json).unwrap();
    let xpriv = parsed["xpriv_str"].as_str().unwrap();

    let key_hex = client::derive_signing_key(xpriv, 0).expect("derive key failed");
    let hash_hex = "b".repeat(64);

    let sig1 = client::sign_schnorr(&key_hex, &hash_hex).expect("sign 1 failed");
    let sig2 = client::sign_schnorr(&key_hex, &hash_hex).expect("sign 2 failed");
    assert_eq!(sig1, sig2);
}

#[wasm_bindgen_test]
fn sign_schnorr_rejects_invalid_key() {
    let result = client::sign_schnorr("not-hex", &"a".repeat(64));
    assert!(result.is_err());
}

#[wasm_bindgen_test]
fn sign_schnorr_rejects_wrong_length_hash() {
    let account_json =
        client::generate_account_keys_from_mnemonic(TEST_MNEMONIC, "").expect("account failed");
    let parsed: serde_json::Value = serde_json::from_str(&account_json).unwrap();
    let xpriv = parsed["xpriv_str"].as_str().unwrap();
    let key_hex = client::derive_signing_key(xpriv, 0).unwrap();

    let result = client::sign_schnorr(&key_hex, "aabb"); // too short
    assert!(result.is_err());
}

#[wasm_bindgen_test]
fn create_commitment_returns_valid_json() {
    let account_json =
        client::generate_account_keys_from_mnemonic(TEST_MNEMONIC, "").expect("account failed");
    let parsed: serde_json::Value = serde_json::from_str(&account_json).unwrap();
    let xpriv = parsed["xpriv_str"].as_str().unwrap();

    let ash = "c".repeat(64); // 32-byte account_state_hash
    let ocr = "d".repeat(64); // 32-byte output_coins_root

    let json = client::create_commitment(xpriv, 0, &ash, &ocr).expect("create_commitment failed");
    let commitment: serde_json::Value = serde_json::from_str(&json).unwrap();

    assert!(commitment["public_key"].is_string());
    assert!(commitment["signature"].is_string());
    assert!(commitment["message"].is_string());

    let sig = commitment["signature"].as_str().unwrap();
    assert_eq!(sig.len(), 128); // 64-byte Schnorr sig
}
