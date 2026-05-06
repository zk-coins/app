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
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

lazy_static! {
    pub static ref SECP256K1: Secp256k1<All> = Secp256k1::new();
}

pub type HashDigest = [u8; 32];
pub type Address = HashDigest;
pub type Amount = u64;

pub fn hash(data: &[u8]) -> HashDigest {
    Sha256::digest(data).into()
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct AccountState {
    pub owner: HashDigest,
    pub balance: u64,
    pub public_key: Vec<u8>,
}

impl AccountState {
    pub fn new(initial_public_key: Vec<u8>) -> Self {
        let mut rng = rand::thread_rng();
        let random_bytes: [u8; 32] = rng.gen();
        let address = hash(&[initial_public_key.clone(), random_bytes.to_vec()].concat());
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
        let account =
            AccountState::new(client_account.generate_public_key(0).serialize().to_vec());
        client_account.address = account.owner;
        client_account
    }
}
