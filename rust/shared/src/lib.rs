use bitcoin::{
    bip32::{ChildNumber, Xpriv, Xpub},
    key::{
        rand::{rngs::OsRng, RngCore},
        Secp256k1,
    },
    secp256k1::{All, PublicKey},
    Network,
};
use lazy_static::lazy_static;
use plonky2::field::goldilocks_field::GoldilocksField;
use plonky2::field::types::Field;
use plonky2::hash::poseidon::PoseidonHash;
use plonky2::plonk::config::Hasher;
use rand::Rng;
use serde::{Deserialize, Serialize};

lazy_static! {
    pub static ref SECP256K1: Secp256k1<All> = Secp256k1::new();
}

pub type HashDigest = [u8; 32];
pub type Address = HashDigest;
pub type Amount = u64;

/// Goldilocks field — the native field of the node's Poseidon (`F = GF(2^64 - 2^32 + 1)`).
type F = GoldilocksField;

/// Protocol hash `H` — Poseidon over Goldilocks, serialised to 32 bytes.
///
/// This MUST stay byte-for-byte identical to the node's
/// `zkcoins_program::hash::{hash_bytes, digest_to_bytes}` (see
/// `node/program-plonky2/src/hash.rs`): the node credits a minted asset to
/// `owner = digest_to_bytes(Poseidon(creator_pubkey))`, so the wallet
/// address — `H(pubkey_0)` — only matches the node's owner when this packing
/// and serialisation match exactly.
///
///   - input bytes packed 7-per-field-element, little-endian (keeps each
///     limb < 2^56 < Goldilocks modulus, so no non-canonical wraparound);
///   - `hash_no_pad` over those field elements;
///   - the 4-element digest serialised big-endian per element to 32 bytes.
///
/// SHA256 (the prior protocol hash) only survives at the Bitcoin-signing
/// boundary, where the WASM signer hashes the message bytes before Schnorr.
pub fn hash(data: &[u8]) -> HashDigest {
    let mut elements = Vec::with_capacity(data.len().div_ceil(7));
    for chunk in data.chunks(7) {
        let mut buf = [0u8; 8];
        buf[..chunk.len()].copy_from_slice(chunk);
        elements.push(F::from_canonical_u64(u64::from_le_bytes(buf)));
    }
    let digest = PoseidonHash::hash_no_pad(&elements);
    let mut out = [0u8; 32];
    for (i, e) in digest.elements.iter().enumerate() {
        out[i * 8..(i + 1) * 8].copy_from_slice(&e.0.to_be_bytes());
    }
    out
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct AccountState {
    pub owner: HashDigest,
    pub balance: u64,
    pub public_key: Vec<u8>,
}

impl AccountState {
    pub fn new(initial_public_key: Vec<u8>) -> Self {
        let address = hash(&initial_public_key);
        AccountState {
            owner: address,
            balance: 0,
            public_key: initial_public_key,
        }
    }
}

pub struct ClientAccount {
    pub address: Address,
    pub num_pubkeys: u32,
    pub private_key: Xpriv,
}

pub fn new_master_private_key() -> Xpriv {
    let mut rng = OsRng;
    let mut seed = [0u8; 32];
    rng.fill_bytes(&mut seed);
    Xpriv::new_master(Network::Bitcoin, &seed).expect("Failed to create private key.")
}

pub fn master_private_key_from_seed(seed: &[u8]) -> Xpriv {
    Xpriv::new_master(Network::Bitcoin, seed).expect("Failed to create private key from seed.")
}

pub fn generate_mnemonic() -> bip39::Mnemonic {
    let mut entropy = [0u8; 16]; // 128 bits = 12 words
    OsRng.fill_bytes(&mut entropy);
    bip39::Mnemonic::from_entropy(&entropy).expect("Failed to generate mnemonic")
}

pub fn mnemonic_to_seed(mnemonic: &bip39::Mnemonic, passphrase: &str) -> [u8; 64] {
    mnemonic.to_seed(passphrase)
}

pub fn validate_mnemonic(phrase: &str) -> bool {
    phrase.parse::<bip39::Mnemonic>().is_ok()
}

impl ClientAccount {
    pub fn generate_public_key(&self, index: u32) -> PublicKey {
        Xpub::from_priv(&SECP256K1, &self.private_key)
            .derive_pub(&SECP256K1, &[ChildNumber::Normal { index }])
            .expect("Failed to derive pubkey")
            .public_key
    }

    pub fn new(private_key: Xpriv) -> Self {
        let mut client_account = ClientAccount {
            address: [0u8; 32],
            num_pubkeys: 0,
            private_key,
        };
        let account = AccountState::new(client_account.generate_public_key(0).serialize().to_vec());
        client_account.address = account.owner;
        client_account
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_MNEMONIC: &str =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn new_master_key_is_random() {
        let key1 = new_master_private_key();
        let key2 = new_master_private_key();
        assert_ne!(key1.to_string(), key2.to_string());
    }

    #[test]
    fn master_key_from_seed_is_deterministic() {
        let seed = [42u8; 32];
        let key1 = master_private_key_from_seed(&seed);
        let key2 = master_private_key_from_seed(&seed);
        assert_eq!(key1.to_string(), key2.to_string());
    }

    #[test]
    fn different_seeds_produce_different_keys() {
        let key1 = master_private_key_from_seed(&[1u8; 32]);
        let key2 = master_private_key_from_seed(&[2u8; 32]);
        assert_ne!(key1.to_string(), key2.to_string());
    }

    #[test]
    fn generate_mnemonic_produces_12_words() {
        let mnemonic = generate_mnemonic();
        let phrase = mnemonic.to_string();
        let words: Vec<&str> = phrase.split_whitespace().collect();
        assert_eq!(words.len(), 12);
    }

    #[test]
    fn generated_mnemonic_is_valid() {
        let mnemonic = generate_mnemonic();
        assert!(validate_mnemonic(&mnemonic.to_string()));
    }

    #[test]
    fn validate_mnemonic_accepts_valid() {
        assert!(validate_mnemonic(TEST_MNEMONIC));
    }

    #[test]
    fn validate_mnemonic_rejects_invalid() {
        assert!(!validate_mnemonic("not a valid mnemonic"));
        assert!(!validate_mnemonic("abandon abandon abandon")); // too few words
        assert!(!validate_mnemonic("")); // empty
    }

    #[test]
    fn mnemonic_to_seed_is_deterministic() {
        let mnemonic: bip39::Mnemonic = TEST_MNEMONIC.parse().unwrap();
        let seed1 = mnemonic_to_seed(&mnemonic, "");
        let seed2 = mnemonic_to_seed(&mnemonic, "");
        assert_eq!(seed1, seed2);
    }

    #[test]
    fn different_passphrase_produces_different_seed() {
        let mnemonic: bip39::Mnemonic = TEST_MNEMONIC.parse().unwrap();
        let seed1 = mnemonic_to_seed(&mnemonic, "");
        let seed2 = mnemonic_to_seed(&mnemonic, "my-passphrase");
        assert_ne!(seed1, seed2);
    }

    #[test]
    fn mnemonic_to_seed_produces_64_bytes() {
        let mnemonic: bip39::Mnemonic = TEST_MNEMONIC.parse().unwrap();
        let seed = mnemonic_to_seed(&mnemonic, "");
        assert_eq!(seed.len(), 64);
    }

    #[test]
    fn client_account_deterministic_from_seed() {
        let seed = [99u8; 32];
        let key = master_private_key_from_seed(&seed);
        let acc1 = ClientAccount::new(key);

        let key2 = master_private_key_from_seed(&seed);
        let acc2 = ClientAccount::new(key2);

        assert_eq!(acc1.address, acc2.address);
    }

    #[test]
    fn client_account_address_is_32_bytes() {
        let key = new_master_private_key();
        let acc = ClientAccount::new(key);
        assert_eq!(acc.address.len(), 32);
        assert_ne!(acc.address, [0u8; 32]); // not all zeros
    }

    #[test]
    fn client_account_pubkey_is_33_bytes_compressed() {
        let key = new_master_private_key();
        let acc = ClientAccount::new(key);
        let pubkey = acc.generate_public_key(0);
        assert_eq!(pubkey.serialize().len(), 33);
        // Compressed pubkey starts with 02 or 03
        let first_byte = pubkey.serialize()[0];
        assert!(first_byte == 0x02 || first_byte == 0x03);
    }

    #[test]
    fn client_account_different_indices_produce_different_pubkeys() {
        let key = new_master_private_key();
        let acc = ClientAccount::new(key);
        let pk0 = acc.generate_public_key(0);
        let pk1 = acc.generate_public_key(1);
        let pk2 = acc.generate_public_key(2);
        assert_ne!(pk0.serialize(), pk1.serialize());
        assert_ne!(pk1.serialize(), pk2.serialize());
    }

    #[test]
    fn account_state_address_is_hash_of_pubkey() {
        let pubkey = vec![0x02; 33]; // dummy compressed pubkey
        let state = AccountState::new(pubkey.clone());
        let expected = hash(&pubkey);
        assert_eq!(state.owner, expected);
        assert_eq!(state.balance, 0);
        assert_eq!(state.public_key, pubkey);
    }

    #[test]
    fn hash_is_deterministic() {
        let data = b"hello zkcoins";
        assert_eq!(hash(data), hash(data));
    }

    #[test]
    fn hash_produces_different_outputs_for_different_inputs() {
        assert_ne!(hash(b"a"), hash(b"b"));
    }

    #[test]
    fn full_mnemonic_to_account_flow() {
        let mnemonic: bip39::Mnemonic = TEST_MNEMONIC.parse().unwrap();
        let seed = mnemonic_to_seed(&mnemonic, "");
        let key = master_private_key_from_seed(&seed);
        let acc = ClientAccount::new(key);

        // Account should have valid address and keys
        assert_ne!(acc.address, [0u8; 32]);
        let pk = acc.generate_public_key(0);
        assert_eq!(pk.serialize().len(), 33);

        // Same mnemonic should produce same account
        let seed2 = mnemonic_to_seed(&mnemonic, "");
        let key2 = master_private_key_from_seed(&seed2);
        let acc2 = ClientAccount::new(key2);
        assert_eq!(acc.address, acc2.address);
    }
}
