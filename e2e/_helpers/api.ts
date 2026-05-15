/**
 * Thin fetch-based API client used by the E2E global setup and test helpers.
 *
 * Mirrors the runtime client in `src/lib/api/client.ts` for the endpoints
 * the test suite needs to touch directly (info, balance, mint). Send and
 * commit are deliberately omitted — those are exercised through the UI.
 *
 * Targets `process.env.E2E_API_URL` (default: dev-api.zkcoins.app).
 */

const API_URL = process.env.E2E_API_URL ?? 'https://dev-api.zkcoins.app';

export interface InfoResponse {
  network: string;
}

export interface BalanceResponse {
  balance: number;
  username?: string;
}

export interface MintResponse {
  success: boolean;
  proof_id?: number;
  account_state_hash?: string;
  output_coins_root?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>');
    throw new Error(`API ${path} ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  info: () => request<InfoResponse>('/api/info'),
  balance: (address: string) =>
    request<BalanceResponse>(`/api/balance?address=${encodeURIComponent(address)}`),
  mint: (address: string) =>
    request<MintResponse>('/api/mint', {
      method: 'POST',
      body: JSON.stringify({ address }),
    }),
};
