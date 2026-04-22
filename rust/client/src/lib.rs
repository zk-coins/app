use bitcoin::{
    key::Secp256k1, secp256k1::{Message, SecretKey}
};
use wasm_bindgen::prelude::*;
use web_sys::{window};
use serde::{Serialize, Deserialize};
use shared::{ClientAccount, new_master_private_key};
use bitcoin::bip32::Xpriv;
use core::str::FromStr;
use wasm_bindgen_futures::JsFuture;
use web_sys::{Request, RequestInit, RequestMode, Headers, Response};

// Declare the warpwallet module
// mod warpwallet;

// Re-export the login and logout functions
// pub use warpwallet::{login, logout};

/// A simple greeting function.
#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

/// Signs a 32-byte hash using a Schnorr signature over a given 32-byte private key.
///
/// The function takes two hex-encoded strings:
/// - `private_key_hex`: The private key in hex (must be 32 bytes).
/// - `hash_hex`: The message hash to sign in hex (must be 32 bytes).
///
/// Returns a hex-encoded Schnorr signature on success or an error as a `JsValue` on failure.
#[wasm_bindgen]
pub fn sign_schnorr(private_key_hex: &str, hash_hex: &str) -> Result<String, JsValue> {
    // Decode the private key from hex.
    let priv_key_bytes = hex::decode(private_key_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hex in private key: {}", e)))?;
    if priv_key_bytes.len() != 32 {
        return Err(JsValue::from_str("Private key must be 32 bytes in hex"));
    }

    // Create the secret key.
    let secret_key = SecretKey::from_slice(&priv_key_bytes)
        .map_err(|e| JsValue::from_str(&format!("Invalid secret key: {}", e)))?;

    // Decode the message hash from hex.
    let hash_bytes = hex::decode(hash_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hex in message hash: {}", e)))?;
    if hash_bytes.len() != 32 {
        return Err(JsValue::from_str("Hash must be 32 bytes in hex"));
    }

    // Construct the message from the 32-byte hash.
    // Note: `from_slice` is deprecated; use `from_digest_slice` instead.
    let msg = Message::from_digest_slice(&hash_bytes)
        .map_err(|e| JsValue::from_str(&format!("Invalid message: {}", e)))?;

    // Create a signing-only secp256k1 context.
    let secp = Secp256k1::signing_only();

    // Convert the secret key into a keypair.
    let keypair = bitcoin::secp256k1::Keypair::from_secret_key(&secp, &secret_key);

    // Sign the message using the keypair.
    let sig = secp.sign_schnorr_no_aux_rand(&msg, &keypair);

    // Return the signature as a hex string.
    Ok(hex::encode(sig.as_ref()))
}

#[derive(Serialize, Deserialize)]
struct StorableClientAccountData {
    address_hex: String,
    num_pubkeys: u32,
    xpriv_str: String,
}

#[wasm_bindgen]
pub async fn create_and_store_new_account() -> Result<String, JsValue> {
    // It's good practice to set up a panic hook for easier debugging in WASM.
    // This should ideally be called once when the WASM module initializes.
    // For simplicity in this function, we'll call it here.
    // If you have a central initialization, move it there.
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let window = window().ok_or_else(|| JsValue::from_str("Failed to obtain window object"))?;
    let local_storage = window.local_storage()
        .map_err(|e| JsValue::from_str(&format!("Error accessing localStorage: {:?}", e)))?
        .ok_or_else(|| JsValue::from_str("localStorage is not available in this browser"))?;

    // Generate a new master private key.
    // new_master_private_key internally uses OsRng, which for wasm relies on getrandom's js feature.
    let master_xpriv = new_master_private_key();

    // Create a new ClientAccount. This also derives the address.
    let client_account = ClientAccount::new(master_xpriv);

    // Prepare the data for serialization.
    let storable_data = StorableClientAccountData {
        address_hex: hex::encode(client_account.address),
        num_pubkeys: client_account.num_pubkeys, // Initialized to 0 by ClientAccount::new
        xpriv_str: client_account.private_key.to_string(), // Serialize Xpriv to its string representation
    };

    let request_payload = ClientMintRequest {
        account_address: storable_data.address_hex.clone(),
        amount: 10_000,
    };

    let request_json = serde_json::to_string(&request_payload)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize send_coins request: {}", e)))?;

    let opts = RequestInit::new();
    opts.set_method("POST");
    opts.set_mode(RequestMode::Cors); // Adjust if necessary
    opts.set_body(&JsValue::from_str(&request_json));

    let headers = Headers::new().map_err(|_| JsValue::from_str("Failed to create Headers"))?;
    headers.set("Content-Type", "application/json").map_err(|_| JsValue::from_str("Failed to set Content-Type header"))?;
    opts.set_headers(&headers);

    // Assuming your server is running on the same origin or configured for CORS.
    // Adjust API_BASE_URL as needed. For now, using a relative path.
    let url = "/api/mint";
    let request = Request::new_with_str_and_init(url, &opts)
        .map_err(|e| JsValue::from_str(&format!("Failed to create Request: {:?}", e)))?;

    let resp_value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|e| JsValue::from_str(&format!("Fetch error: {:?}", e)))?;

    let resp: Response = resp_value
        .dyn_into()
        .map_err(|_| JsValue::from_str("Failed to convert JsValue to Response"))?;

    if !resp.ok() {
        let error_text = JsFuture::from(resp.text().map_err(|_| JsValue::from_str("Failed to get response text"))?)
            .await
            .map_err(|_| JsValue::from_str("Failed to get error response text"))?
            .as_string()
            .unwrap_or_else(|| "Unknown error".to_string());
        return Err(JsValue::from_str(&format!(
            "Server error: {} - {}",
            resp.status(),
            error_text
        )));
    }

    // Serialize to JSON.
    let json_data = serde_json::to_string(&storable_data)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize account data to JSON: {}", e)))?;

    // Define a key for localStorage.
    let storage_key = format!("account_{}", storable_data.address_hex);

    // Store the JSON string in localStorage.
    local_storage.set_item(&storage_key, &json_data)
        .map_err(|e| JsValue::from_str(&format!("Failed to store account in localStorage: {:?}", e)))?;

    // TODO: Receive some tokens from the minting account

    // Return the hex-encoded address of the newly created and stored account.
    Ok(storable_data.address_hex)
}

// Example of how you might retrieve it (optional, not requested but good for completeness)
/*
#[wasm_bindgen]
pub fn get_stored_account(address_hex: &str) -> Result<JsValue, JsValue> {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let window = window().ok_or_else(|| JsValue::from_str("Failed to obtain window object"))?;
    let local_storage = window.local_storage()
        .map_err(|e| JsValue::from_str(&format!("Error accessing localStorage: {:?}", e)))?
        .ok_or_else(|| JsValue::from_str("localStorage is not available"))?;

    let storage_key = format!("account_{}", address_hex);
    
    match local_storage.get_item(&storage_key) {
        Ok(Some(json_data)) => {
            let storable_data: StorableClientAccountData = serde_json::from_str(&json_data)
                .map_err(|e| JsValue::from_str(&format!("Failed to deserialize account data: {}", e)))?;
            // For now, just returning the JsValue from the serialized struct.
            // If you need to reconstruct ClientAccount, you'd use Xpriv::from_str(&storable_data.xpriv_str)
            // and then create the ClientAccount if needed in Rust.
            // Or, just return the fields as a JS object.
            Ok(serde_wasm_bindgen::to_value(&storable_data)?)
        }
        Ok(None) => Err(JsValue::from_str(&format!("Account not found for address: {}", address_hex))),
        Err(e) => Err(JsValue::from_str(&format!("Error retrieving account from localStorage: {:?}", e))),
    }
}
*/

// Re-define PublicKey alias if not already globally available in this scope
// from the existing sign_schnorr function's imports.
// It seems `bitcoin::secp256k1::PublicKey` is directly used in shared::ClientAccount.generate_public_key
// so we can use that directly. Let's use an alias for clarity if needed.
type BitcoinSecp256k1PublicKey = bitcoin::secp256k1::PublicKey;

#[derive(Serialize, Debug)] // Added Debug for logging potential errors
struct ClientSendCoinRequest {
    account_address: String, // hex of sender
    recipient: String,       // hex of recipient
    amount: u64,
    public_key: BitcoinSecp256k1PublicKey, 
    next_public_key: BitcoinSecp256k1PublicKey,
}

#[derive(Serialize, Debug)]
pub struct ClientMintRequest {
    account_address: String,
    amount: u64,
}

#[derive(Deserialize, Debug, Serialize)] // Added Serialize to return as JsValue easily
struct ClientSendCoinResponse {
    success: bool,
    proof_id: Option<u64>,
}

#[wasm_bindgen]
pub async fn send_coins_from_browser(
    sender_address_hex: String,
    recipient_address_hex: String,
    amount_str: String, // Amount as string to avoid JS number precision issues with u64
) -> Result<JsValue, JsValue> {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once(); // Call panic hook

    let amount = amount_str.parse::<u64>().map_err(|e| {
        JsValue::from_str(&format!("Invalid amount format: {}. Expected u64.", e))
    })?;

    let window = window().ok_or_else(|| JsValue::from_str("Failed to obtain window object"))?;
    let local_storage = window
        .local_storage()
        .map_err(|e| JsValue::from_str(&format!("Error accessing localStorage: {:?}", e)))?
        .ok_or_else(|| JsValue::from_str("localStorage is not available"))?;

    let storage_key = format!("account_{}", sender_address_hex);
    let account_json_data = local_storage
        .get_item(&storage_key)
        .map_err(|e| JsValue::from_str(&format!("Error retrieving account: {:?}", e)))?
        .ok_or_else(|| JsValue::from_str(&format!("Account {} not found in localStorage", sender_address_hex)))?;

    let mut storable_data: StorableClientAccountData = serde_json::from_str(&account_json_data)
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize account data: {}", e)))?;

    let sender_xpriv = Xpriv::from_str(&storable_data.xpriv_str)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse Xpriv from stored string: {}", e)))?;
    
    // Decode sender_address_hex to bytes for the temporary ClientAccount struct if needed for its address field.
    // shared::ClientAccount address field is [u8; 32].
    let mut sender_address_bytes = [0u8; 32];
    hex::decode_to_slice(&sender_address_hex, &mut sender_address_bytes)
        .map_err(|e| JsValue::from_str(&format!("Failed to decode sender_address_hex: {}", e)))?;

    // Create a temporary ClientAccount to use its methods for key generation.
    // Note: ClientAccount::new derives address differently. Here we assume the stored address_hex is the source of truth for the Address field.
    let temp_client_account = ClientAccount {
        address: sender_address_bytes, // Use the address this function was called with
        num_pubkeys: storable_data.num_pubkeys, // This is not directly used by generate_public_key, index is passed
        private_key: sender_xpriv,
    };

    let current_public_key = temp_client_account.generate_public_key(storable_data.num_pubkeys);
    let next_public_key = temp_client_account.generate_public_key(storable_data.num_pubkeys + 1);

    let request_payload = ClientSendCoinRequest {
        account_address: sender_address_hex.clone(),
        recipient: recipient_address_hex,
        amount,
        public_key: current_public_key,
        next_public_key,
    };

    let request_json = serde_json::to_string(&request_payload)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize send_coins request: {}", e)))?;

    let opts = RequestInit::new();
    opts.set_method("POST");
    opts.set_mode(RequestMode::Cors); // Adjust if necessary
    opts.set_body(&JsValue::from_str(&request_json));

    let headers = Headers::new().map_err(|_| JsValue::from_str("Failed to create Headers"))?;
    headers.set("Content-Type", "application/json").map_err(|_| JsValue::from_str("Failed to set Content-Type header"))?;
    opts.set_headers(&headers);

    // Assuming your server is running on the same origin or configured for CORS.
    // Adjust API_BASE_URL as needed. For now, using a relative path.
    let url = "/api/send";
    let request = Request::new_with_str_and_init(url, &opts)
        .map_err(|e| JsValue::from_str(&format!("Failed to create Request: {:?}", e)))?;

    let resp_value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|e| JsValue::from_str(&format!("Fetch error: {:?}", e)))?;

    let resp: Response = resp_value
        .dyn_into()
        .map_err(|_| JsValue::from_str("Failed to convert JsValue to Response"))?;

    if !resp.ok() {
        let error_text = JsFuture::from(resp.text().map_err(|_| JsValue::from_str("Failed to get response text"))?)
            .await
            .map_err(|_| JsValue::from_str("Failed to get error response text"))?
            .as_string()
            .unwrap_or_else(|| "Unknown error".to_string());
        return Err(JsValue::from_str(&format!(
            "Server error: {} - {}",
            resp.status(),
            error_text
        )));
    }

    let resp_json = JsFuture::from(resp.json().map_err(|_| JsValue::from_str("Failed to parse response as JSON"))?)
        .await
        .map_err(|_| JsValue::from_str("Failed to parse response as JSON"))?;

    let server_response: ClientSendCoinResponse = serde_wasm_bindgen::from_value(resp_json.clone())
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize server response: {}", e)))?;

    if server_response.success {
        // Update the stored account data with the incremented num_pubkeys
        storable_data.num_pubkeys += 1;
        let updated_account_json_data = serde_json::to_string(&storable_data)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize updated account data: {}", e)))?;
        local_storage.set_item(&storage_key, &updated_account_json_data)
            .map_err(|e| JsValue::from_str(&format!("Failed to update account in localStorage: {:?}", e)))?;
    }

    // Return the server response as a JsValue
    Ok(resp_json)
}
