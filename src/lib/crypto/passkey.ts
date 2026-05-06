/**
 * WebAuthn Passkey service for zkCoins.
 *
 * Adapted from DFX Wallet's passkey architecture:
 * - Uses PRF extension to derive deterministic entropy from Secure Enclave
 * - HKDF-SHA256 for domain-separated key derivation
 * - Falls back to encrypted seed storage if PRF is unavailable
 */

const RP_ID = 'zkcoins.app';
const RP_NAME = 'zkCoins';
const PRF_SALT_STRING = 'zkcoins-wallet-v1';

let prfSaltCache: Uint8Array | null = null;

async function getPrfSalt(): Promise<Uint8Array> {
  if (prfSaltCache) return prfSaltCache;
  const encoded = new TextEncoder().encode(PRF_SALT_STRING);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  prfSaltCache = new Uint8Array(hash);
  return prfSaltCache;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64Url(buffer: Uint8Array): string {
  let binary = '';
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

export class PasskeyPrfUnsupportedError extends Error {
  constructor() {
    super('PRF extension is not supported on this device');
    this.name = 'PasskeyPrfUnsupportedError';
  }
}

export interface PasskeyResult {
  credentialId: string;
  prfOutput: Uint8Array;
}

export async function createPasskey(): Promise<PasskeyResult> {
  const prfSalt = await getPrfSalt();
  const userId = randomBytes(16);
  const challenge = randomBytes(32);

  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { id: RP_ID, name: RP_NAME },
      user: {
        id: userId.buffer as ArrayBuffer,
        name: `zkcoins-${Date.now()}`,
        displayName: 'zkCoins Wallet',
      },
      challenge: challenge.buffer as ArrayBuffer,
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 (P-256)
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      attestation: 'none',
      extensions: {
        // @ts-expect-error PRF extension type not in standard lib
        prf: { eval: { first: prfSalt } },
      },
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Passkey creation was cancelled');
  }

  const extensionResults = credential.getClientExtensionResults() as Record<string, unknown>;
  const prfResults = extensionResults?.prf as
    | { enabled?: boolean; results?: { first?: ArrayBuffer } }
    | undefined;

  if (!prfResults?.enabled && !prfResults?.results?.first) {
    throw new PasskeyPrfUnsupportedError();
  }

  const prfOutput = prfResults.results?.first ? new Uint8Array(prfResults.results.first) : null;

  if (!prfOutput || prfOutput.length === 0) {
    throw new PasskeyPrfUnsupportedError();
  }

  return {
    credentialId: toBase64Url(new Uint8Array(credential.rawId)),
    prfOutput,
  };
}

export async function authenticatePasskey(credentialId?: string): Promise<PasskeyResult> {
  const prfSalt = await getPrfSalt();
  const challenge = randomBytes(32);

  const allowCredentials: PublicKeyCredentialDescriptor[] = credentialId
    ? [{ type: 'public-key', id: fromBase64Url(credentialId).buffer as ArrayBuffer }]
    : [];

  const credential = (await navigator.credentials.get({
    publicKey: {
      rpId: RP_ID,
      challenge: challenge.buffer as ArrayBuffer,
      allowCredentials,
      userVerification: 'required',
      extensions: {
        // @ts-expect-error PRF extension type not in standard lib
        prf: { eval: { first: prfSalt } },
      },
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Passkey authentication was cancelled');
  }

  const extensionResults = credential.getClientExtensionResults() as Record<string, unknown>;
  const prfResults = extensionResults?.prf as { results?: { first?: ArrayBuffer } } | undefined;

  const prfOutput = prfResults?.results?.first ? new Uint8Array(prfResults.results.first) : null;

  if (!prfOutput || prfOutput.length === 0) {
    throw new PasskeyPrfUnsupportedError();
  }

  return {
    credentialId: toBase64Url(new Uint8Array(credential.rawId)),
    prfOutput,
  };
}
