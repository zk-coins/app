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
// 2. **Runtime server capabilities** derived from `GET /v1/info.features`
//    (closed set §6.1). Consumers must read runtime bits via
//    `useFeatures()` inside a component.

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
 * Build-time client flags only. Safe to read in non-React contexts.
 * Does NOT expose any server-reported capability.
 */
export const FEATURES = buildTime;

/**
 * Merged feature set: build-time client flags + opt-in runtime server
 * capabilities from `GET /v1/info`.
 */
export function useFeatures() {
  const caps = useCapabilities((s) => s.capabilities);
  const loaded = useCapabilities((s) => s.loaded);
  return useMemo(
    () =>
      ({
        ...buildTime,
        USERNAME_CLAIM: caps.username_claim,
        // v1 is multi-asset by construction; the bit stays for screen
        // branching that still reads MULTI_ASSET.
        MULTI_ASSET: caps.multi_asset,
        loaded,
      }) as const,
    [caps.username_claim, caps.multi_asset, loaded],
  );
}
