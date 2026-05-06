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

export interface SendRequest {
  account_address: string;
  recipient: string;
  amount: number;
  public_key: string;
  next_public_key: string;
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

  balance: (address: string) => request<BalanceResponse>(`/api/balance?address=${address}`),

  info: () => request<InfoResponse>('/api/info'),
};
