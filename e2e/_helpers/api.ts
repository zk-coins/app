/**
 * SDK-backed API client used by the E2E global setup and test helpers.
 *
 * The app now consumes `@zkcoins/sdk` for all node traffic; the E2E
 * harness does the same so the test-side and app-side wire contracts
 * cannot drift. The helpers only touch the unsigned endpoints the suite
 * needs directly — info, balance, mint (faucet). Send + commit are
 * exercised through the UI (specs 07 / 13), which runs the real WASM
 * signing path against the node.
 *
 * Mint goes through the SDK's `ZkCoinsAccount.mint`, which admits at
 * `POST /api/jobs/mint` (mandatory `Idempotency-Key`) and polls
 * `GET /api/jobs/:id` to `completed` — the async Jobs API (node PR #161).
 *
 * Targets `process.env.E2E_API_URL` (default: dev-api.zkcoins.app).
 */

import {
  ZkCoinsClient,
  newIdempotencyKey,
  type InfoResponse,
  type BalanceResponse,
} from '@zkcoins/sdk';

const API_URL = process.env.E2E_API_URL ?? 'https://dev-api.zkcoins.app';

/** A `ZkCoinsClient` pointed at the configured E2E API URL. */
const sdkClient = new ZkCoinsClient({ apiUrl: API_URL });

/** Faucet mint amount (sats) used to seed Alice in globalSetup. */
const MINT_AMOUNT_SATS = 100_000;

export const api = {
  info: (): Promise<InfoResponse> => sdkClient.info(),
  balance: (address: string): Promise<BalanceResponse> => sdkClient.balance(address),
  /**
   * Faucet mint via the SDK client: admit `POST /api/jobs/mint`
   * (mandatory `Idempotency-Key`), then poll to `completed`. Throws if
   * the job ends in `failed` / `cancelled` or the poll times out. A mint
   * is fully server-mediated (no wallet signature), so it credits the
   * `address` argument directly — no account keys are involved.
   */
  mint: async (address: string, amount: number = MINT_AMOUNT_SATS): Promise<void> => {
    const accepted = await sdkClient.mintJob(
      { account_address: address, amount },
      newIdempotencyKey(),
    );
    await pollMintToCompleted(accepted.job_id);
  },
};

const MINT_POLL_TIMEOUT_MS = 120_000;
const MINT_POLL_FLOOR_MS = 2_000;

/** Poll a mint job to `completed`, throwing on terminal failure / timeout. */
async function pollMintToCompleted(jobId: string): Promise<void> {
  const deadline = Date.now() + MINT_POLL_TIMEOUT_MS;
  for (;;) {
    const job = await sdkClient.getJob(jobId);
    if (job.status === 'completed') return;
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(`mint job ${jobId} ${job.status}: ${job.error ?? 'unknown'}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `mint job ${jobId} did not reach a terminal state within ${MINT_POLL_TIMEOUT_MS}ms (last: ${job.status})`,
      );
    }
    await new Promise((r) => setTimeout(r, MINT_POLL_FLOOR_MS));
  }
}

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
 * domain is per-stage: `dev.zkcoins.app` on DEV, `zkcoins.app` on PRD,
 * `local.zkcoins.test` on a local node.
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
