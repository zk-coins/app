/**
 * Detection for the node's deterministic re-mint rejection.
 *
 * The node refuses a second mint into an existing `(owner, asset_id)`
 * account ("Re-mint into an existing asset account is not supported",
 * `node/src/account_node.rs`). With a DETERMINISTIC fixture asset name
 * (the single-asset seeding leg in `_global-setup.ts`) that rejection is
 * reachable from the seeding retry loop: attempt N admits and completes
 * server-side, but the client's completed-poll blips (a single fetch
 * error or the poll timeout), so attempt N+1 re-admits the same name and
 * the node rejects it — even though the wallet is in fact funded. The
 * retry loop treats this rejection on attempt >= 2 as "already seeded"
 * and lets the caller's balance poll independently verify the funding.
 *
 * Kept in its own dependency-free module so the predicate stays
 * unit-testable (see `src/__tests__/e2e/remint-guard.test.ts`) without
 * pulling the SDK `_helpers/api.ts` into vitest.
 */

/** Node message fragment for a rejected re-mint (`account_node.rs`). */
export const RE_MINT_REJECTION_FRAGMENT = 'Re-mint into an existing asset account';

/**
 * True when `err` carries the node's re-mint rejection, regardless of the
 * surface it travelled through: the admit-time HTTP 4xx body (wrapped by
 * `postJson` as `POST /v1/jobs/mint <status>: <body>`) or a `failed`
 * job's `error` field (wrapped by the job-poll helpers as
 * `mint job <id> failed: <error>`) — both embed the node message in the
 * thrown `Error`'s message.
 */
export function isReMintRejection(err: unknown): boolean {
  return err instanceof Error && err.message.includes(RE_MINT_REJECTION_FRAGMENT);
}
