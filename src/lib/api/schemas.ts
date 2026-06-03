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
 *     `proof_id` on a completed mint job that emits no proof).
 *   - Inferred response types are re-exported from `client.ts`
 *     (`BalanceResponse`, `InfoResponse`, `JobStatus`, …). Consumers
 *     import the type from `client.ts`, the schema from here.
 */

import { z } from 'zod';

export const BalanceResponseSchema = z.object({
  balance: z.number(),
  username: z.string().optional(),
  // Authoritative BIP-32 child-index counter for the queried account.
  // Equals the number of times the address has executed a
  // `/api/send` round-trip (= the server's `Account.num_sends` field
  // — see the corresponding `BalanceResponse` doc on the node side).
  //
  // The wallet hydrates its local `numPubkeys` from this value on
  // every balance tick, replacing the previous "track locally,
  // increment on every successful send" scheme that desynced after
  // a seed restore (the restore flow resets `numPubkeys` to 0
  // regardless of past sends, which then either omits the
  // `prev_commitment_pubkey` parameter or collides on the same SMT
  // slot at commit time — both failure modes surfaced as
  // `07-send.spec.ts::send-success` failing on DEV).
  //
  // `.default(0)` so a pre-PR server (no field on the wire) still
  // parses and the wallet falls back to the local counter. The
  // matching node-side change emits this unconditionally.
  num_sends: z.number().default(0),
});

export const UsernameResponseSchema = z.object({
  username: z.string(),
  address: z.string(),
});

// `claim` and `resolve` use the same `{username, address}` envelope.
export const ClaimUsernameResponseSchema = UsernameResponseSchema;
export const ResolveUsernameResponseSchema = UsernameResponseSchema;

// Server-side feature gates, mirrored from
// `zk-coins/node::router.rs::Capabilities`. Each bool reflects a
// compile-time Cargo feature on the server binary for an *opt-in*
// feature — i.e. one that may or may not be served by a given node.
//
// MVP surface (mint/faucet endpoints, username resolve/display) is
// permanently part of every node build and therefore not represented
// here: there is no "is the server offering us mint today?" question
// to ask. Only features that a self-hoster can switch off get a bit.
export const CapabilitiesSchema = z.object({
  address_list: z.boolean(),
  // Server-side `username-claim` Cargo feature: write path for the
  // `POST /api/username/claim` endpoint. Read-side resolve/display is
  // MVP and always available regardless of this bit.
  username_claim: z.boolean(),
  lnurl: z.boolean(),
});

export const InfoResponseSchema = z.object({
  // Human-readable display string (`"Mainnet"`, `"Mutinynet"`, …) —
  // free-text, capitalisation set by the node and only safe to render,
  // never to branch on. Kept for the network badge in settings.
  network: z.string(),
  // Normalised network enum, lower-case, derived server-side from
  // `is_mainnet` (zk-coins/node#193). Unlike `network` it is a closed
  // set with stable casing, so protocol-level decisions (e.g. whether
  // the faucet may be offered) branch on this field — see
  // `WalletScreen`'s `showFaucet`. Optional (fail-open) so an app
  // talking to a pre-#193 node that only ships `network` still parses;
  // the consumer falls back to the free-text field in that case.
  bitcoin_network: z.enum(['mainnet', 'mutinynet']).optional(),
  // Optional so a fresh app talking to a pre-capabilities server
  // (zk-coins/node pre-#29) doesn't trip the Zod gate. The
  // capabilities store applies a fail-closed default in that case.
  capabilities: CapabilitiesSchema.optional(),
  // Optional for the same reason — pre-#32 servers don't ship this
  // field. The network store falls back to the empty string and the
  // UI treats that as a loading state. Mismatched stages remain
  // visible because the post-#32 server reports its real hostname.
  username_domain: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Jobs API (`/api/jobs/*`)
//
// The node serves mint/send/commit as asynchronous jobs (node PR #161):
// the synchronous `/api/{mint,send,commit}` routes were removed. These
// schemas mirror the long-term canonical TypeScript surface in the SDK
// (`@zkcoins/sdk` PR #19, `src/schemas.ts`), which in turn mirrors the
// live node router DTOs in `zk-coins/node/node/src/router.rs`.
//
// No-fallback contract: a present-but-malformed field hard-fails at the
// boundary (`ZodError`) rather than coercing to a default. `.optional()`
// is reserved for fields the node legitimately omits per state.
// ---------------------------------------------------------------------------

/**
 * Terminal + non-terminal job states — `job_store::JobStatus`
 * (`serde(rename_all = "snake_case")`). Terminal: `completed`, `failed`,
 * `cancelled` (`JobStatus::is_terminal`).
 */
export const JobStatusValueSchema = z.enum([
  'queued',
  'proving',
  'awaiting_signature',
  'broadcasting',
  'completed',
  'failed',
  'cancelled',
]);

/** Job kind — `job_store::JobKind` (`serde(rename_all = "snake_case")`). */
export const JobKindSchema = z.enum(['mint', 'send']);

/**
 * 202 admit body for `POST /api/jobs/{mint,send}` —
 * `router::JobAcceptedResponse`. `job_id` is a UUID string; `status` is
 * the snake_case `JobStatus` the row was admitted at (`"queued"` for a
 * fresh job).
 */
export const JobAcceptedSchema = z.object({
  job_id: z.string(),
  status: z.string(),
});

/**
 * Terminal `result` payload of a completed mint/send job — the JSON
 * body `flow::{mint_flow,commit_flow}` returns, surfaced verbatim on the
 * job row's `result` once `status = completed`, and (node #195) on an
 * `awaiting_signature` send job so the wallet can build the commitment
 * from JSON instead of decoding the binary CoinProof. Same envelope the
 * pre-Jobs-API synchronous endpoints returned.
 */
export const JobResultSchema = z.object({
  success: z.boolean(),
  proof_id: z.number().nullable().optional(),
  account_state_hash: z.string().optional(),
  output_coins_root: z.string().optional(),
});

/**
 * `GET /api/jobs/{id}` poll body **and** the SSE `data:` frame payload —
 * `router::JobStatusResponse` / the SSE event builders.
 *
 * Field availability is status-dependent (the node only populates a
 * field in the state where it is meaningful):
 *
 *   - `proof_id` — set when `status = awaiting_signature` (the id of the
 *     server-side send proof; echoed back in the commit body).
 *   - `result` — set when `status = completed`, and (node #195) when
 *     `status = awaiting_signature` so the wallet can read
 *     `account_state_hash` / `output_coins_root` as JSON.
 *   - `error` — set when `status = failed`.
 *
 * `job_id` / `kind` / `progress` are `.optional()` (absent from SSE
 * frames); `proof_id` / `result` / `error` are `.nullable().optional()`
 * (elided on poll, explicit `null` on SSE).
 */
export const JobStatusSchema = z.object({
  job_id: z.string().optional(),
  kind: JobKindSchema.optional(),
  status: JobStatusValueSchema,
  phase: z.string(),
  progress: z.number().optional(),
  proof_id: z.number().nullable().optional(),
  result: JobResultSchema.nullable().optional(),
  error: z.string().nullable().optional(),
});

/**
 * Generic Jobs-API error envelope — `router::JobErrorResponse`
 * (`{ error: string }`). The client's `ApiError` mapping reads `error`
 * when present, so this also covers the legacy `{success:false, error}`
 * shape.
 */
export const JobErrorResponseSchema = z.object({
  error: z.string(),
});
