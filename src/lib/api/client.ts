import { useNetworkStore } from '@/stores/network';
import { initWasm } from '@zkcoins/wasm';

function getApiUrl(): string {
  return useNetworkStore.getState().apiUrl;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiUrl()}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export interface SendRequest {
  account_address: string;
  recipient: string;
  amount: number;
  public_key: string;
  next_public_key: string;
}

export interface SignedSendRequest extends SendRequest {
  signature: string;
  timestamp: number;
}

export interface BalanceResponse {
  balance: number;
}

export interface SendResponse {
  success: boolean;
  proof_id: number | null;
}

export interface InfoResponse {
  network: string;
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

export const api = {
  mint: (address: string, amount: number = 10_000) =>
    request<SendResponse>('/api/mint', {
      method: 'POST',
      body: JSON.stringify({ account_address: address, amount }),
    }),

  send: (data: SendRequest) =>
    request<SendResponse>('/api/send', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  sendSigned: async (data: SendRequest, xpriv: string, numPubkeys: number) => {
    const signed = await signSendRequest(data, xpriv, numPubkeys);
    return request<SendResponse>('/api/send', {
      method: 'POST',
      body: JSON.stringify(signed),
    });
  },

  balance: (address: string) => request<BalanceResponse>(`/api/balance?address=${address}`),

  info: () => request<InfoResponse>('/api/info'),
};
