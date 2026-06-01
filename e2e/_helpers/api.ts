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
  /**
   * Server-reported username domain. Per stage: `dev.zkcoins.app` on DEV,
   * `zkcoins.app` on PRD. The frontend renders address chips as
   * `{8hex}@<username_domain>` and `/api/username/resolve` strips this
   * suffix, so it MUST be read from the server rather than hardcoded.
   */
  username_domain?: string;
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
  // Mirrors `src/lib/api/client.ts::api.mint` — the server expects
  // `{ account_address, amount }` and rejects missing fields with 422.
  mint: (address: string, amount: number = 100_000) =>
    request<MintResponse>('/api/mint', {
      method: 'POST',
      body: JSON.stringify({ account_address: address, amount }),
    }),
};

/**
 * Session-scoped cache for the server-reported `username_domain`. Populated
 * lazily by `getUsernameDomain()` and shared across helpers so we hit
 * `/api/info` once per run, not once per locator build.
 */
let cachedUsernameDomain: string | null = null;

/**
 * Resolve the server-reported `username_domain` once per test session.
 *
 * The frontend renders address chips as `{8hex}@<username_domain>` and the
 * domain is per-stage: `dev.zkcoins.app` on DEV, `zkcoins.app` on PRD.
 *
 * Fails loud if `/api/info` is unreachable or doesn't return a domain —
 * a hardcoded fallback would let a misconfigured CI silently match the
 * wrong stage's chip and pass tests that should have failed.
 */
export async function getUsernameDomain(): Promise<string> {
  if (cachedUsernameDomain !== null) return cachedUsernameDomain;
  const info = await api.info();
  const domain = info.username_domain;
  if (!domain) {
    throw new Error(
      `api helper: /api/info (${API_URL}) did not return \`username_domain\`. ` +
        'The frontend renders address chips as `{8hex}@<username_domain>` and the e2e ' +
        'helpers derive their locators from it — a missing field means the server ' +
        'is older than PR #98 or the API URL is wrong.',
    );
  }
  cachedUsernameDomain = domain;
  return domain;
}

/**
 * Build the wallet-chip regex for a given username domain. Pure function so
 * callers can share the same string with Playwright's `text=/…/` locator API.
 */
export function zkAddressRegex(domain: string): RegExp {
  // Escape regex metacharacters in the domain (in practice only `.`, but
  // do it generically so a future `dev-2.zkcoins.app`-style stage doesn't
  // break the regex).
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`[0-9a-f]{8}@${escaped}`);
}
