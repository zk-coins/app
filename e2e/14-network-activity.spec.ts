/**
 * Spec 14 — Network activity (`/network`) page golden
 *
 * Covers § 8.14 of e2e/README.md. The `/network` "Network activity" screen
 * (`src/app/network/page.tsx`) is the last always-on, ungated user-facing
 * page without a page-level visual-regression golden — spec 09 only shoots
 * the network *badge* on the Settings header, never `/network` itself
 * (issue #166). 2 tests, 2 linux baselines (desktop + mobile), which takes
 * golden coverage of the live, ungated screens to 100%.
 *
 * `/network` has no route guard and reads no wallet state, so it needs no
 * login fixture — a direct navigation renders the page.
 *
 * ── Determinism ───────────────────────────────────────────────────────
 * The page renders a live, self-advancing chart. Three sources of variance
 * are pinned so the baseline is byte-stable run-to-run and across runners:
 *
 *   1. **Clock.** `buildHistory({ endTs = Date.now(), seed = 1337 })` is
 *      deterministic only when `Date.now()` is frozen (seeded `mulberry32`).
 *      `page.clock.install` alone is NOT enough: it resumes real time, so
 *      `Date.now()` keeps drifting and the `POLL_MS = 8000` `setInterval`
 *      fires once mount→snapshot crosses ~8 s — appending a `nextSample()`
 *      built from unseeded `Math.random` (verified against the 1.59 clock
 *      engine). We therefore `install` then `pauseAt(FIXED_CLOCK)` BEFORE
 *      navigating: that freezes `Date.now()` at the fixed instant AND halts
 *      every timer, so the 220-sample waveform and the time-of-day x-axis
 *      labels are byte-identical every run and the chart can never tick.
 *
 *   2. **Timezone + locale.** The x-axis labels go through
 *      `toLocaleTimeString()`, which is timezone- and locale-sensitive. CI
 *      runs UTC, a dev machine does not; pin both (`timezoneId`, `locale`)
 *      so the rendered "06:00 PM"-style ticks match on every host.
 *
 *   3. **Data source.** `getNetworkActivity` falls back to the local
 *      simulator unless `NEXT_PUBLIC_EXPLORER_URL` is set AND the endpoint
 *      responds. Served-local CI bakes that var to the (not-yet-live) PRD
 *      explorer, so we abort the probe and force the deterministic
 *      simulated path. Builds with the var unset make no request at all, so
 *      the route is simply inert there.
 *
 * Locators: role/text-based (the page exposes no testids of its own; the
 * chart carries `role="img"` + an aria-label).
 */

import { expect, test, type Page } from '@playwright/test';
import { snap, setViewport } from './_helpers/screenshot';

// The instant the page clock is pinned to. A fixed UTC instant well clear
// of any DST boundary (UTC has none) so the simulated 6-hour window and its
// `toLocaleTimeString` x-axis ticks are stable run-to-run.
const FIXED_CLOCK = new Date('2026-01-01T18:00:00.000Z');
// `pauseAt` only fast-forwards (it throws on a past target), so the clock is
// installed a hair before FIXED_CLOCK and immediately paused exactly on it.
const PRE_FIXED_CLOCK = new Date(FIXED_CLOCK.getTime() - 60_000);

test.describe('Network activity', () => {
  // Block the service worker so `page.route` reliably intercepts the
  // cross-origin explorer probe (a PWA SW can short-circuit fetches before
  // the route handler sees them — this bit the wasm route in spec 02). Pin
  // timezone + locale so the chart's `toLocaleTimeString` ticks are stable
  // regardless of where the suite runs.
  test.use({ serviceWorkers: 'block', timezoneId: 'UTC', locale: 'en-US' });

  /** Navigate to a frozen, simulated-source `/network` ready to snapshot. */
  async function gotoNetworkFrozen(page: Page): Promise<void> {
    // Freeze time BEFORE the page's scripts run: `install` then `pauseAt`
    // pins `Date.now()` at FIXED_CLOCK (deterministic `buildHistory`) and
    // halts every timer, so the POLL_MS interval can never fire a live
    // `nextSample()` tick between navigation and the snapshot.
    await page.clock.install({ time: PRE_FIXED_CLOCK });
    await page.clock.pauseAt(FIXED_CLOCK);
    // Force the simulated data source irrespective of the build's
    // NEXT_PUBLIC_EXPLORER_URL (see determinism note 3).
    await page.route('**/network/activity*', (route) => route.abort());

    await page.goto('/network');

    // The chart mounts only once the first (simulated) sample batch lands.
    await expect(page.getByRole('img', { name: 'Network activity chart' })).toBeVisible({
      timeout: 10_000,
    });
    // Hard guard that we are snapshotting the SIMULATED state: this note is
    // gated on `source === 'simulated'`. If the explorer ever goes live and
    // the abort regresses, this fails loudly instead of baking
    // non-deterministic live data into the baseline.
    await expect(page.getByText('The zkCoins explorer is not yet live')).toBeVisible();
  }

  test('network-activity-desktop', async ({ page }) => {
    await setViewport(page, 'desktop');
    await gotoNetworkFrozen(page);
    await snap(page, '14-network-activity-desktop');
  });

  test('network-activity-mobile', async ({ page }) => {
    await setViewport(page, 'mobile');
    await gotoNetworkFrozen(page);
    await snap(page, '14-network-activity-mobile');
  });
});
