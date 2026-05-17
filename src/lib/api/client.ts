import type { ZodType, z } from 'zod';
import { useNetworkStore } from '@/stores/network';
import { initWasm } from '@zkcoins/wasm';
import {
  BalanceResponseSchema,
  ClaimUsernameResponseSchema,
  CommitResponseSchema,
  InfoResponseSchema,
  MintResponseSchema,
  ResolveUsernameResponseSchema,
  SendResponseSchema,
  UsernameResponseSchema,
} from './schemas';

// Response types are inferred from the schemas in `./schemas.ts` so the
// schema is the single source of truth. The public names match the
// pre-Zod interface names callers already import — no churn for them.
export type SendResponse = z.infer<typeof SendResponseSchema>;
export type BalanceResponse = z.infer<typeof BalanceResponseSchema>;
export type UsernameResponse = z.infer<typeof UsernameResponseSchema>;
export type InfoResponse = z.infer<typeof InfoResponseSchema>;

function getApiUrl(): string {
  return useNetworkStore.getState().apiUrl;
}

const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes (proof generation can be slow)

async function request<T>(path: string, schema: ZodType<T>, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  /* c8 ignore next — 2-minute timeout callback, not triggered in unit tests */
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${getApiUrl()}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...options,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }
    return schema.parse(await res.json());
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface SendRequest {
  account_address: string;
  recipient: string;
  amount: number;
  public_key: string;
  next_public_key: string;
  prev_commitment_pubkey?: string;
}

export interface SignedSendRequest extends SendRequest {
  signature: string;
  timestamp: number;
}

export interface ClaimUsernameParams {
  username: string;
  address: string;
  xpriv: string;
}

export interface CommitRequest {
  proof_id: number;
  public_key: string;
  signature: string;
  message: string;
}

/**
 * Sign a send request with Schnorr.
 * Message = SHA256(account_address || recipient || amount_le || timestamp_le)
 */
async function signSendRequest(
  data: SendRequest,
  xpriv: string,
  numPubkeys: number,
): Promise<SignedSendRequest> {
  const timestamp = Math.floor(Date.now() / 1000);

  // Build the message bytes matching server's hash construction
  const encoder = new TextEncoder();
  const addressBytes = encoder.encode(data.account_address);
  const recipientBytes = encoder.encode(data.recipient);
  const amountBytes = new Uint8Array(8);
  new DataView(amountBytes.buffer).setBigUint64(0, BigInt(data.amount), true);
  const timestampBytes = new Uint8Array(8);
  new DataView(timestampBytes.buffer).setBigUint64(0, BigInt(timestamp), true);

  const combined = new Uint8Array(
    addressBytes.length + recipientBytes.length + amountBytes.length + timestampBytes.length,
  );
  let offset = 0;
  combined.set(addressBytes, offset);
  offset += addressBytes.length;
  combined.set(recipientBytes, offset);
  offset += recipientBytes.length;
  combined.set(amountBytes, offset);
  offset += amountBytes.length;
  combined.set(timestampBytes, offset);

  // SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Derive private key at the current index for signing
  const wasm = await initWasm();
  const signingKey = wasm.deriveSigningKey(xpriv, numPubkeys);
  const signature = wasm.signSchnorr(signingKey, hashHex);

  return {
    ...data,
    signature,
    timestamp,
  };
}

/**
 * Sign a username claim request with Schnorr using pubkey_0 (identity key).
 * Message = SHA256("zkcoins:claim_username" || address_hex || username || timestamp_le)
 */
async function signClaimRequest(
  params: ClaimUsernameParams,
): Promise<{ public_key: string; signature: string; timestamp: number }> {
  const timestamp = Math.floor(Date.now() / 1000);
  const wasm = await initWasm();

  const keys = wasm.derivePublicKeys(params.xpriv, 0);
  const signingKey = wasm.deriveSigningKey(params.xpriv, 0);

  const encoder = new TextEncoder();
  const prefix = encoder.encode('zkcoins:claim_username');
  const addressBytes = encoder.encode(params.address);
  const usernameBytes = encoder.encode(params.username);
  const timestampBytes = new Uint8Array(8);
  new DataView(timestampBytes.buffer).setBigUint64(0, BigInt(timestamp), true);

  const combined = new Uint8Array(
    prefix.length + addressBytes.length + usernameBytes.length + timestampBytes.length,
  );
  let offset = 0;
  combined.set(prefix, offset);
  offset += prefix.length;
  combined.set(addressBytes, offset);
  offset += addressBytes.length;
  combined.set(usernameBytes, offset);
  offset += usernameBytes.length;
  combined.set(timestampBytes, offset);

  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const signature = wasm.signSchnorr(signingKey, hashHex);

  return { public_key: keys.publicKey, signature, timestamp };
}

export const api = {
  mint: (address: string, amount: number = 10_000) =>
    request('/api/mint', MintResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ account_address: address, amount }),
    }),

  send: (data: SendRequest) =>
    request('/api/send', SendResponseSchema, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  sendSigned: async (data: SendRequest, xpriv: string, numPubkeys: number) => {
    const signed = await signSendRequest(data, xpriv, numPubkeys);
    return request('/api/send', SendResponseSchema, {
      method: 'POST',
      body: JSON.stringify(signed),
    });
  },

  commit: (data: CommitRequest) =>
    request('/api/commit', CommitResponseSchema, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  balance: async (address: string): Promise<BalanceResponse> => {
    try {
      return await request(`/api/balance?address=${address}`, BalanceResponseSchema);
    } catch (err) {
      // The server returns HTTP 404 for addresses it has never seen
      // (no mint / no incoming send yet) but the body itself is the
      // correct `{balance: 0}`. Surface that 0 instead of propagating
      // the throw so freshly created or restored wallets actually
      // render the "Wallet is empty" banner instead of the loading
      // placeholder. Backend issue tracked separately — once the
      // server returns 200 for unknown addresses, this branch becomes
      // dead code and can be removed.
      if (err instanceof Error && err.message.startsWith('API error 404')) {
        return { balance: 0 };
      }
      throw err;
    }
  },

  info: () => request('/api/info', InfoResponseSchema),

  claimUsername: async (params: ClaimUsernameParams) => {
    const signed = await signClaimRequest(params);
    return request('/api/username/claim', ClaimUsernameResponseSchema, {
      method: 'POST',
      body: JSON.stringify({
        username: params.username,
        address: params.address,
        public_key: signed.public_key,
        signature: signed.signature,
        timestamp: signed.timestamp,
      }),
    });
  },

  resolveUsername: (username: string) =>
    request(`/api/username/resolve/${encodeURIComponent(username)}`, ResolveUsernameResponseSchema),
};
