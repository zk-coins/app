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
  // Present on 4xx/5xx error bodies (server PR #31). Absent on success.
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

// Server-side feature gates, mirrored from
// `zk-coins/server::server.rs::Capabilities`. Each bool reflects a
// compile-time Cargo feature on the server binary, so the client can
// gate UI on a single source of truth instead of mirroring a parallel
// `NEXT_PUBLIC_ENABLE_*` set.
export const CapabilitiesSchema = z.object({
  address_list: z.boolean(),
  faucet: z.boolean(),
  usernames: z.boolean(),
  lnurl: z.boolean(),
});

export const InfoResponseSchema = z.object({
  network: z.string(),
  // Optional so a fresh app talking to a pre-capabilities server
  // (zk-coins/server pre-#29) doesn't trip the Zod gate. The
  // capabilities store applies a fail-closed default in that case.
  capabilities: CapabilitiesSchema.optional(),
});
