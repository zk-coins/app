/**
 * AES-GCM encryption via Web Crypto API.
 *
 * Two key derivation paths:
 * - Passkey: HKDF from PRF output → AES key
 * - Password: PBKDF2 from user password → AES key
 */

const PBKDF2_ITERATIONS = 100_000;
const HKDF_SALT = 'zkcoins-wallet-encryption';
const HKDF_INFO = 'aes-key-v1';

export interface EncryptedData {
  ciphertext: string; // base64
  iv: string; // base64
  salt?: string; // base64, only for password-derived keys
}

function toBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function deriveKeyFromPassword(
  password: string,
  salt?: Uint8Array,
): Promise<{ key: CryptoKey; salt: Uint8Array }> {
  const actualSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: actualSalt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  return { key, salt: actualSalt };
}

export async function deriveKeyFromPrf(prfOutput: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    prfOutput.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveKey'],
  );

  const salt = new TextEncoder().encode(HKDF_SALT);
  const info = new TextEncoder().encode(HKDF_INFO);

  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encrypt(
  data: string,
  key: CryptoKey,
  salt?: Uint8Array,
): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(data);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    encoded,
  );

  return {
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv.buffer as ArrayBuffer),
    salt: salt ? toBase64(salt.buffer as ArrayBuffer) : undefined,
  };
}

export async function decrypt(encrypted: EncryptedData, key: CryptoKey): Promise<string> {
  const ciphertext = fromBase64(encrypted.ciphertext);
  const iv = fromBase64(encrypted.iv);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer,
  );

  return new TextDecoder().decode(decrypted);
}
