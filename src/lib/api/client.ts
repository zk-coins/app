import { useNetworkStore } from '@/stores/network';

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

export interface MintRequest {
  address: string;
}

export interface SendRequest {
  sender: string;
  recipient: string;
  amount: number;
  sender_public_key: string;
  sender_next_public_key: string;
}

export interface BalanceResponse {
  balance: number;
}

export interface MintResponse {
  proof_id: string;
}

export interface SendResponse {
  proof_id: string;
}

export interface InfoResponse {
  network: string;
}

export const api = {
  mint: (data: MintRequest) =>
    request<MintResponse>('/api/mint', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  send: (data: SendRequest) =>
    request<SendResponse>('/api/send', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  balance: (address: string) => request<BalanceResponse>(`/api/balance?address=${address}`),

  info: () => request<InfoResponse>('/api/info'),
};
