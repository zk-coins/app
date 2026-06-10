/**
 * Live API contract test (neutral multi-asset model).
 *
 * Skipped by default. Runs only when `process.env.RUN_API_CONTRACT === 'true'`.
 * The point is to catch the case where the Rust server response shape drifts
 * from what the Zod schemas expect — before it shows up as an opaque crash.
 *
 * **Endpoint choice.** The probe stays on endpoints that don't require a
 * full WASM signing path (the real WASM module does not load under vitest's
 * happy-dom runner — that belongs in the Playwright e2e suite):
 *
 *   - `GET  /api/info`                  → InfoResponseSchema
 *   - `GET  /api/balance/:address`      → OwnerBalanceResponseSchema
 *   - `GET  /api/balance?address&asset` → BalanceResponseSchema
 *
 * The create-coin (mint) lifecycle needs Schnorr signing, so it is exercised
 * end-to-end by the e2e harness against a real node, not here.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { api, BalanceResponseSchema, OwnerBalanceResponseSchema } from '@/lib/api/client';
import { useNetworkStore } from '@/stores/network';
import { InfoResponseSchema } from '@zkcoins/sdk';

const RUN = process.env.RUN_API_CONTRACT === 'true';
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4242';

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

  it('GET /api/balance/:address parses against OwnerBalanceResponseSchema', async () => {
    const res = await api.ownerBalances(randomAddress());
    expect(() => OwnerBalanceResponseSchema.parse(res)).not.toThrow();
    expect(Array.isArray(res.assets)).toBe(true);
  });

  it('GET /api/balance?address&asset_id parses against BalanceResponseSchema', async () => {
    const res = await api.balance(randomAddress(), randomAddress());
    expect(() => BalanceResponseSchema.parse(res)).not.toThrow();
    expect(typeof res.balance).toBe('number');
  });
});
