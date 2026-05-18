/**
 * Zod schemas at the HTTP boundary.
 *
 * Issue #68 / Workstream 3.
 *
 * Every `await res.json()` in `client.ts` is funnelled through one of
 * these schemas via `Schema.parse(...)`. Drift between the Rust server
 * and this client surfaces as a thrown `ZodError` at the boundary —
 * caught loud by either the unit-test gate or the opt-in live contract
 * test (`src/__tests__/lib/api/contract.live.test.ts`).
 *
 * Conventions:
 *   - Default `z.object()` is `strip` mode: unknown keys are dropped
 *     silently, so a new server field doesn't break the client — only
 *     a *rename* or a *removed* field surfaces as a parse error. That
 *     is exactly the failure mode we want to detect.
 *   - Optional fields are explicitly `.optional()` and may also be
 *     `.nullable()` where the server actually sends `null` (e.g.
 *     `proof_id` on a successful mint that emits no proof).
 *   - Inferred response types are re-exported from `client.ts` under
 *     their historical names (`SendResponse`, `BalanceResponse`, …).
 *     Consumers import the type from `client.ts`, the schema from here.
 */

import { z } from 'zod';

export const SendResponseSchema = z.object({
  success: z.boolean(),
  // Server's structured error body for non-2xx responses (mirrors
  // `account_server::map_send_coins_error`'s output). `request()`
  // surfaces this on the thrown error message so callers can show
  // a specific user-fixable string rather than a JSON blob.
  error: z.string().optional(),
  proof_id: z.number().nullable().optional(),
  account_state_hash: z.string().optional(),
  output_coins_root: z.string().optional(),
});

// `mint` and `commit` return the same envelope as `send` today. Aliased
// rather than re-defined so a future divergence is a single-file change
// (and so the test-time mock helpers can pick a schema per endpoint).
export const MintResponseSchema = SendResponseSchema;
export const CommitResponseSchema = SendResponseSchema;

export const BalanceResponseSchema = z.object({
  balance: z.number(),
  username: z.string().optional(),
});

export const UsernameResponseSchema = z.object({
  username: z.string(),
  address: z.string(),
});

// `claim` and `resolve` use the same `{username, address}` envelope.
export const ClaimUsernameResponseSchema = UsernameResponseSchema;
export const ResolveUsernameResponseSchema = UsernameResponseSchema;

export const InfoResponseSchema = z.object({
  network: z.string(),
});
