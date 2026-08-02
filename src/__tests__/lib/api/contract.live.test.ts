/**
 * Live API contract probe (v1 surface).
 *
 * Skipped by default. Runs only when `process.env.RUN_API_CONTRACT === 'true'`.
 * Probes endpoints that do not invent wallet state:
 *   - GET /v1/info
 *   - ownerBalances (expected 501 until AccountState decode ships)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ApiError, api } from '@/lib/api/client';
import { useNetworkStore } from '@/stores/network';

const RUN = process.env.RUN_API_CONTRACT === 'true';
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4242';

describe.skipIf(!RUN)('live API contract (v1)', () => {
  beforeAll(() => {
    useNetworkStore.setState({ apiUrl: API_URL });
  });

  it('GET /v1/info returns a network + features list', async () => {
    const res = await api.info();
    expect(typeof res.network).toBe('string');
    expect(res.network.length).toBeGreaterThan(0);
    expect(Array.isArray(res.features)).toBe(true);
  });

  it('ownerBalances fails closed with 501 (not an empty wallet)', async () => {
    await expect(
      api.ownerBalances('zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'),
    ).rejects.toSatisfy((err: unknown) => err instanceof ApiError && err.status === 501);
  });
});
