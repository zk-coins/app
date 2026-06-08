/**
 * Declarative screen → golden registry for `golden-coverage.mjs`.
 *
 * Why this exists: route screens are auto-derivable from
 * `src/app/<seg>/page.tsx`, but the state-driven views at `/` (Onboarding,
 * Unlock, Wallet) are NOT routes, so they cannot be enumerated from the
 * filesystem. This registry is the single hand-maintained list the audit
 * checks against. Every active, ungated screen MUST appear here with at
 * least one expected baseline; the audit fails CI when a non-gated
 * `page.tsx` route is missing here, or when a registered baseline file is
 * absent from its `e2e/*.spec.ts-snapshots/` directory.
 *
 * `gate` mirrors the env-gated flag set in `e2e/_audit/gates.mjs`
 * (`ENV_GATED_FEATURES`). A gated screen documents an intentionally
 * uncovered route (its body is dead-stripped from the shipped bundle) and
 * is not required to carry a baseline. The audit cross-checks that a
 * registry `gate` is one of the recognised flags AND that it matches the
 * `!FEATURES.<gate>) notFound()` guard actually present in the route's
 * source — so the registry cannot quietly claim a gate the code doesn't.
 */

/** How a screen is reached: a real route, or a state of the `/` app root. */
export type ScreenReach =
  | { readonly kind: 'route'; readonly path: string }
  | { readonly kind: 'state'; readonly route: string; readonly state: string };

/**
 * One expected golden. `spec` is the spec-file stem (its snapshot
 * directory is `e2e/<spec>.spec.ts-snapshots/`); `name` is the baseline
 * basename without the `-chromium-linux.png` platform suffix.
 */
export interface ExpectedBaseline {
  readonly spec: string;
  readonly name: string;
}

export interface Screen {
  /** Stable identifier (used in the audit's report). */
  readonly id: string;
  /** Human-facing label. */
  readonly title: string;
  readonly reach: ScreenReach;
  /**
   * Expected golden(s). Required (non-empty) for active screens; left
   * empty for `gate`d screens, which carry no baseline by design.
   */
  readonly baselines: readonly ExpectedBaseline[];
  /**
   * Env-gate flag (one of `ENV_GATED_FEATURES`) when the screen is
   * intentionally uncovered because it is dead-stripped from the bundle.
   */
  readonly gate?: string;
  /** Optional human note for the registry / report. */
  readonly note?: string;
}

export const SCREENS: readonly Screen[] = [
  // ── State-driven views at `/` (not routes — must be declared here) ──
  {
    id: 'onboarding-welcome',
    title: 'Onboarding — Welcome',
    reach: { kind: 'state', route: '/', state: 'welcome (no stored wallet)' },
    baselines: [
      { spec: '01-onboarding-welcome', name: '01-welcome-desktop' },
      { spec: '01-onboarding-welcome', name: '01-welcome-mobile' },
    ],
  },
  {
    id: 'onboarding-create-seed',
    title: 'Onboarding — Create seed',
    reach: { kind: 'state', route: '/', state: 'create-seed reveal' },
    baselines: [{ spec: '02-create-seed', name: '02-seed-reveal-shown' }],
  },
  {
    id: 'onboarding-restore-seed',
    title: 'Onboarding — Restore seed',
    reach: { kind: 'state', route: '/', state: 'restore-seed entry' },
    baselines: [{ spec: '03-restore-seed', name: '03-restore-entry-empty' }],
  },
  {
    id: 'unlock',
    title: 'Unlock (stored wallet, locked)',
    reach: { kind: 'state', route: '/', state: 'hasStoredWallet && isLocked' },
    baselines: [{ spec: '04-unlock-password', name: '04-unlock-empty' }],
  },
  {
    id: 'wallet',
    title: 'Wallet home (account, unlocked)',
    reach: { kind: 'state', route: '/', state: 'account && !isLocked' },
    baselines: [
      { spec: '06-balance', name: '06-balance-funded-desktop' },
      { spec: '06-balance', name: '06-balance-funded-mobile' },
    ],
  },

  // ── Route screens (auto-inventoried; each must appear here) ─────────
  {
    id: 'send',
    title: 'Send Bitcoin',
    reach: { kind: 'route', path: '/send' },
    baselines: [{ spec: '07-send', name: '07-send-default' }],
  },
  {
    id: 'tx-detail',
    title: 'Transaction detail',
    reach: { kind: 'route', path: '/tx/[id]' },
    baselines: [
      { spec: '17-tx-detail', name: '17-tx-detail-desktop' },
      { spec: '17-tx-detail', name: '17-tx-detail-mobile' },
    ],
  },
  {
    id: 'receive',
    title: 'Receive Bitcoin',
    reach: { kind: 'route', path: '/receive' },
    baselines: [
      { spec: '08-receive', name: '08-receive-default-desktop' },
      { spec: '08-receive', name: '08-receive-default-mobile' },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    reach: { kind: 'route', path: '/settings' },
    baselines: [
      { spec: '05-disconnect', name: '05-settings-desktop' },
      { spec: '05-disconnect', name: '05-settings-mobile' },
    ],
  },
  {
    id: 'network',
    title: 'Network activity',
    reach: { kind: 'route', path: '/network' },
    baselines: [
      { spec: '14-network-activity', name: '14-network-activity-desktop' },
      { spec: '14-network-activity', name: '14-network-activity-mobile' },
    ],
  },
  // ── Env-gated routes (dead-stripped from the bundle — no golden) ────
  {
    id: 'create',
    title: 'Create coin',
    reach: { kind: 'route', path: '/create' },
    baselines: [],
    gate: 'MULTI_ASSET',
    note: 'Gated by NEXT_PUBLIC_ENABLE_MULTI_ASSET (off in single-asset bundles). Covered by spec 18, which skips on a multi_asset:false node and runs against a true node.',
  },
  {
    id: 'asset-detail',
    title: 'Per-asset detail',
    reach: { kind: 'route', path: '/asset/[id]' },
    baselines: [],
    gate: 'MULTI_ASSET',
    note: 'Gated by NEXT_PUBLIC_ENABLE_MULTI_ASSET (off in single-asset bundles). Covered by spec 21, which skips on a multi_asset:false node and runs against a true node.',
  },
  {
    id: 'apps',
    title: 'Apps directory',
    reach: { kind: 'route', path: '/apps' },
    baselines: [],
    gate: 'APPS_DIRECTORY',
    note: 'Gated by NEXT_PUBLIC_ENABLE_APPS_DIRECTORY (off in shipped bundles).',
  },
  {
    id: 'reset',
    title: 'Dev reset route',
    reach: { kind: 'route', path: '/reset' },
    baselines: [],
    gate: 'DEV_ROUTES',
    note: 'Gated by NEXT_PUBLIC_ENABLE_DEV_ROUTES (off in shipped bundles).',
  },
  // `/simulate` (dev demo-history route) was removed in issue #175: it
  // injected fabricated rows into the retired local transaction store,
  // which no longer exists — history is server-owned (`GET /api/history`).
];
