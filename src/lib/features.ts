// Feature gates.
//
// Two flavours coexist:
//
// 1. **Build-time client flags** (`NEXT_PUBLIC_ENABLE_*`). Inlined by
//    Next.js, so `if (FEATURES_BUILDTIME.X)` branches against `false`
//    are removed by dead-code elimination — gated code does not ship
//    in the bundle. All flags default off (fail-closed); set the env
//    var to the literal string `"true"` at build time to opt in.
//
// 2. **Runtime server capabilities** (`USERNAME_CLAIM`, …). Reported
//    by the server at `/api/info` (see
//    `zk-coins/node::router.rs::Capabilities`) and stored in
//    `useCapabilities`. Only *opt-in* server features get a bit:
//    MVP functionality (mint/faucet endpoints, username resolve and
//    display) is permanently part of every node build and is therefore
//    unconditional in the UI — no capability check guards it.
//    Consumers must read runtime bits via `useFeatures()` inside a
//    component, so the component re-renders when the capabilities
//    load. Reading them statically from `process.env` would force
//    operators to mirror the server's Cargo feature set in the app's
//    build flags, which is the drift problem this hook exists to
//    remove.

import { useMemo } from 'react';
import { useCapabilities } from '@/stores/capabilities';

const on = (value: string | undefined): boolean => value === 'true';

const buildTime = {
  PASSKEY: on(process.env.NEXT_PUBLIC_ENABLE_PASSKEY),
  APPS_DIRECTORY: on(process.env.NEXT_PUBLIC_ENABLE_APPS_DIRECTORY),
  DEV_ROUTES: on(process.env.NEXT_PUBLIC_ENABLE_DEV_ROUTES),
  AUTO_LOCK: on(process.env.NEXT_PUBLIC_ENABLE_AUTO_LOCK),
  ADDRESS_ROTATION: on(process.env.NEXT_PUBLIC_ENABLE_ADDRESS_ROTATION),
  TOR_ROUTING: on(process.env.NEXT_PUBLIC_ENABLE_TOR_ROUTING),
  // Multi-asset *routes* (`/create`, `/asset/[id]`) only exist when the
  // build opts into the neutral multi-asset model. This build-time flag
  // dead-strips those dedicated routes from single-asset bundles (the
  // PRD/DEV default) via `!FEATURES.MULTI_ASSET) notFound()` — the same
  // DCE the golden-coverage audit relies on for `/apps` and `/reset`.
  //
  // It is intentionally distinct from the *runtime* `multi_asset`
  // capability (read via `useCapabilities` / `useFeatures()`), which the
  // shared screens (Wallet, Send) read to switch between the single-asset
  // hero and the per-asset surface at runtime. A capability-adaptive
  // bundle (flag ON) still renders the single-asset UI when the node it
  // talks to reports `multi_asset:false`.
  MULTI_ASSET: on(process.env.NEXT_PUBLIC_ENABLE_MULTI_ASSET),
} as const;

/**
 * Build-time client flags only. Safe to read in non-React contexts
 * (`notFound()` page guards, module-level constants). Does NOT expose
 * any server-reported capability — those must be read via
 * `useFeatures()` so the consumer re-renders when `/api/info` lands.
 */
export const FEATURES = buildTime;

/**
 * Merged feature set: build-time client flags + opt-in runtime server
 * capabilities. Subscribes to the capabilities store, so the host
 * component re-renders when `/api/info` lands.
 *
 * MVP server functionality (mint, username resolve/display) is
 * unconditional and is not represented here — call those endpoints
 * directly. Only features a self-hoster might switch off get a flag.
 */
export function useFeatures() {
  const caps = useCapabilities((s) => s.capabilities);
  // Memo on the underlying booleans so the returned object is reference-
  // stable across renders that didn't change a capability. Without this,
  // every render produces a fresh object and any consumer that puts
  // `features` in a `useEffect` dependency list would loop.
  return useMemo(
    () =>
      ({
        ...buildTime,
        USERNAME_CLAIM: caps.username_claim,
        // Runtime capability (overrides the build-time `buildTime.MULTI_ASSET`
        // spread above): the shared Wallet / Send screens read this to pick
        // the single-asset hero vs the per-asset surface based on what the
        // *connected node* reports, independent of the build flag that gates
        // the dedicated multi-asset routes.
        MULTI_ASSET: caps.multi_asset,
      }) as const,
    [caps.username_claim, caps.multi_asset],
  );
}
