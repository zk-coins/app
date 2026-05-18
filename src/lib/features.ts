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
// 2. **Runtime server capabilities** (`FAUCET`, `USERNAMES`). These
//    are reported by the server at `/api/info` (see
//    `zk-coins/server::server.rs::Capabilities`) and stored in
//    `useCapabilities`. Consumers must read them via `useFeatures()`
//    inside a component, so the component re-renders when the
//    capabilities load. Reading them statically from `process.env`
//    would force operators to mirror the server's Cargo feature set
//    in the app's build flags, which is the drift problem this hook
//    exists to remove.

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
} as const;

/**
 * Build-time client flags only. Safe to read in non-React contexts
 * (`notFound()` page guards, module-level constants). Does NOT expose
 * `FAUCET` or `USERNAMES` — those are server-side capabilities and
 * must be read via `useFeatures()` so the consumer re-renders when
 * `/api/info` lands.
 */
export const FEATURES = buildTime;

/**
 * Merged feature set: build-time client flags + runtime server
 * capabilities. Subscribes to the capabilities store, so the host
 * component re-renders when `/api/info` lands.
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
        FAUCET: caps.faucet,
        USERNAMES: caps.usernames,
      }) as const,
    [caps.faucet, caps.usernames],
  );
}
