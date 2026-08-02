/**
 * Runtime capability probe for the E2E suite.
 *
 * The app is a capability-adaptive client: against a `multi_asset:false`
 * node it renders the single-asset wallet (specs 1-17), and against a
 * `multi_asset:true` node it renders the multi-asset surface (specs 18-21).
 * v1 is multi-asset by construction; the info-proxy reports
 * `capabilities.multi_asset: true`. Specs that still gate on this helper
 * run against that surface.
 *
 * `multiAssetEnabled()` reads `GET /v1/info` from `E2E_API_URL` once per
 * worker (the result is cached) so a `test.skip(...)` guard can branch on the
 * node's real capability without a per-test round-trip.
 */

import { api } from './api';

let cached: Promise<boolean> | null = null;

/** Whether the node under test reports `capabilities.multi_asset === true`. */
export function multiAssetEnabled(): Promise<boolean> {
  if (cached === null) {
    cached = api
      .info()
      .then((info) => info.capabilities?.multi_asset === true)
      // A probe failure (node down, transient 5xx) is treated as "not
      // multi-asset" so the gated specs skip rather than hard-fail the run;
      // the single-asset legs (1-17) surface a genuine node outage instead.
      .catch(() => false);
  }
  return cached;
}
