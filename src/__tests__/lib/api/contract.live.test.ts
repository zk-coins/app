/**
 * Live API contract test.
 *
 * Issue #68 / Workstream 3 — Layer B.
 *
 * Skipped by default. Runs only when `process.env.RUN_API_CONTRACT === 'true'`,
 * which is set by the `api-contract.yml` GitHub Actions workflow (push
 * to `main`, weekly cron, `workflow_dispatch`) and locally when you
 * opt in. The whole point is to catch the case where the Rust server
 * response shape drifts from what the Zod schemas in
 * `src/lib/api/schemas.ts` expect — *before* it shows up as an opaque
 * crash in production.
 *
 * Cost / flake: each invocation hits the real API target
 * (`E2E_API_URL || https://dev-api.zkcoins.app`), spends a real proof,
 * and is gated by server health. Hence not part of required per-PR CI.
 *
 * **Endpoint choice.** The probe deliberately stays on endpoints that
 * do not require Schnorr-signed payloads:
 *
 *   - `GET  /api/info`                     → InfoResponseSchema
 *   - `POST /api/mint   {address, amount}` → MintResponseSchema
 *   - `GET  /api/balance?address=…`        → BalanceResponseSchema
 *
 * `SendResponseSchema` and `CommitResponseSchema` are aliases of
 * `MintResponseSchema`, so the mint round-trip covers their shape too.
 * Adding a real `/api/send` probe would mean running real WASM, and
 * the real WASM module does not load under vitest's happy-dom runner
 * (`isWasm === false`, JS fallback throws on every method) — that
 * branch belongs in the Playwright e2e suite, not here.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { api } from '@/lib/api/client';
import { useNetworkStore } from '@/stores/network';
import { BalanceResponseSchema, InfoResponseSchema, MintResponseSchema } from '@/lib/api/schemas';

const RUN = process.env.RUN_API_CONTRACT === 'true';
const API_URL = process.env.E2E_API_URL ?? 'https://dev-api.zkcoins.app';

/** Random 64-hex address. The server accepts any well-formed address
 *  for `/api/mint`; we never need to control the underlying keys. */
function randomAddress(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe.skipIf(!RUN)('live API contract', () => {
  beforeAll(() => {
    useNetworkStore.setState({ apiUrl: API_URL });
  });

  it('GET /api/info parses against InfoResponseSchema', async () => {
    const res = await api.info();
    expect(() => InfoResponseSchema.parse(res)).not.toThrow();
    expect(typeof res.network).toBe('string');
  });

  it('POST /api/mint parses against MintResponseSchema', async () => {
    const minted = await api.mint(randomAddress());
    expect(() => MintResponseSchema.parse(minted)).not.toThrow();
    expect(minted.success).toBe(true);
  });

  it('GET /api/balance parses against BalanceResponseSchema', async () => {
    // Mint into a fresh address, then read its balance back. The
    // 404→{balance:0} branch in `api.balance` is exercised on
    // never-seen addresses; here we want a fully populated row.
    const address = randomAddress();
    await api.mint(address);
    const res = await api.balance(address);
    expect(() => BalanceResponseSchema.parse(res)).not.toThrow();
    expect(res.balance).toBeGreaterThan(0);
  });
});
