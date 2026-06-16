/**
 * Shared env-gate source of truth for the static audits
 * (`coverage.mjs` — button inventory, and `golden-coverage.mjs` — screen
 * → golden coverage).
 *
 * `ENV_GATED_FEATURES` is the set of build-time client feature flags
 * (`NEXT_PUBLIC_ENABLE_*`, see `src/lib/features.ts`) that default OFF in
 * the PRD/DEV bundles. Because the flag is statically `false` at build
 * time, Next.js dead-code-eliminates the gated branch — the code (a
 * route's body behind `if (!FEATURES.X) notFound()`, a `{FEATURES.X &&
 * (...)}` button) does not ship and cannot be driven on the hosted
 * images. Anything gated behind one of these flags is therefore out of
 * scope for both audits.
 *
 * This is the same exemption ground (a) — "build-time DCE" — documented
 * on `EXEMPT_TESTIDS` in `coverage.mjs`. Keeping the flag set here,
 * imported by both audits, is what stops the button audit and the golden
 * audit from drifting apart on what "env-gated" means: add a flag here
 * once and both audits honour it.
 *
 * NOT included (deliberately):
 *   - Runtime *server* capabilities (`username_claim`, …). Those are
 *     reported by `/api/info`, not build flags, and are exempted
 *     per-testid in `coverage.mjs` (ground (b)); they gate no route.
 *   - Build flags that exist but gate neither a route nor an audited
 *     element today (`AUTO_LOCK`, `ADDRESS_ROTATION`, `TOR_ROUTING`).
 *     A route newly gated behind one of those would (correctly) be
 *     flagged by `golden-coverage.mjs` until the flag is promoted here
 *     with a justification — silence is not the default.
 */

/**
 * Build-time `NEXT_PUBLIC_ENABLE_*` flags that default off in the shipped
 * bundles, so code behind them is dead-stripped and out of scope (env-gated).
 * Names match the keys of `FEATURES` in `src/lib/features.ts`.
 */
export const ENV_GATED_FEATURES = Object.freeze([
  'PASSKEY',
  'APPS_DIRECTORY',
  'DEV_ROUTES',
  // The dedicated multi-asset routes (`/create`, `/asset/[id]`) are guarded
  // by `!FEATURES.MULTI_ASSET) notFound()`. The flag defaults off in the
  // single-asset PRD/DEV bundles the committed baselines are captured
  // against, so the route bodies are dead-stripped and carry no golden —
  // exactly the env-gate contract this set encodes. Their multi-asset specs
  // (18-21) skip on a `multi_asset:false` node and run on a true node.
  'MULTI_ASSET',
]);

/** Whether `flag` is a recognised env-gate (one of {@link ENV_GATED_FEATURES}). */
export function isEnvGatedFeature(flag) {
  return ENV_GATED_FEATURES.includes(flag);
}
