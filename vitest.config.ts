import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@/': path.resolve(__dirname, './src/') + '/',
      '@zkcoins/wasm': path.resolve(__dirname, './packages/zkcoins-wasm/src/index.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/**',
        'src/stores/**',
        'src/hooks/**',
        'src/components/**',
        'src/app/**',
        // E2E-only `/api/info` proxy. Not app code, but it is security-
        // sensitive (it handles upstream errors + logs), so its pure
        // logic is unit-tested and pinned at 100 % below. The standalone
        // entry that binds a port is `c8 ignore`d (E2E-exercised only).
        'scripts/e2e-info-proxy.mjs',
      ],
      // Exclude code paths that are not part of the MVP activated surface.
      // The PRD bundle is built with every NEXT_PUBLIC_ENABLE_* flag off, so
      // these files are unreachable from any user-facing route and we don't
      // require unit coverage on them. The Network Activity chart is `keep`-
      // tagged in the triage and never exercised in the MVP path either.
      exclude: [
        'src/__tests__/**',
        'src/lib/crypto/passkey.ts', // gated by NEXT_PUBLIC_ENABLE_PASSKEY
        'src/lib/simulate-network.ts', // network activity chart (triage: keep)
        'src/lib/api/explorer.ts', // network activity chart (triage: keep)
        // App + component surface exclusions:
        'src/app/layout.tsx', // Next.js root layout, no logic
        'src/app/apps/page.tsx', // FEATURES.APPS_DIRECTORY → notFound() in PRD
        'src/app/reset/page.tsx', // FEATURES.DEV_ROUTES → notFound() in PRD
        'src/app/network/page.tsx', // network activity chart (triage: keep)
        'src/components/NetworkActivity.tsx', // network activity chart (triage: keep)
        'src/components/PixelIcon.tsx', // decorative sprite data
        'src/components/icons/**', // decorative svg wrappers
      ],
      reporter: ['text', 'lcov'],
      // Coverage thresholds operate at two tiers:
      //
      // 1. `src/lib/**` + `src/stores/**` (the original MVP activated
      //    surface) — strict 100 % on every axis. Any new line,
      //    statement, branch, or function that is not exercised by a
      //    test fails CI. Defensive code that genuinely cannot be
      //    reached in the unit test environment (SSR guards, IDB
      //    error callbacks, timeout fallbacks) is marked
      //    `/* c8 ignore */` at the source.
      //
      // 2. Global aggregate (now also includes `src/app/**` +
      //    `src/components/**`) — set just below the current numbers
      //    so any regression that drops coverage on the UI surface
      //    fails CI. Calibrated after the second wave of UI tests
      //    (home / receive / settings / Onboarding-create) landed —
      //    the WalletScreen-branches PR (#109) was retired as
      //    obsolete after the Capabilities-shrink refactor, so the
      //    aggregate settles ~85 % on lines instead of the ~90 %
      //    the original plan assumed.
      //
      //    The `@zkcoins/sdk` migration removed the app-owned
      //    `src/lib/api/schemas.ts` (the wire schemas now come from the
      //    SDK). Those statements were 100 %-covered, so dropping them
      //    shrank the aggregate denominator and nudged the statement
      //    figure to ~84.9 %; the global statement floor is recalibrated
      //    to 84 accordingly. The strict per-glob `src/lib/**` /
      //    `src/stores/**` 100 % gate below is unchanged and still
      //    enforces full coverage on the activated surface.
      //
      //    Issue #188: the `src/app/**` route surface was lifted to 100 %
      //    function coverage (every route-component handler now has a unit
      //    test; the only excluded paths are the disabled-only settings
      //    Toggle handlers, `c8 ignore`d at source). The global `functions`
      //    floor is recalibrated upward (86 → 93) to lock that gain in, and
      //    a per-glob `src/app/**` functions:100 gate (below) pins the route
      //    surface at full function coverage so it cannot silently regress —
      //    same rationale as the strict lib/stores/hooks gates.
      thresholds: {
        // Global aggregate over every included file (incl. lib/stores).
        lines: 85,
        statements: 84,
        functions: 93,
        branches: 74,
        // Original strict gate, applied per-glob aggregate. The
        // aggregate over `src/lib/**` (and `src/stores/**`) must be
        // 100 %, which — since aggregate = covered / total — is
        // equivalent to every file in those globs being fully
        // covered, matching the prior per-file invariant.
        'src/lib/**': { lines: 100, statements: 100, functions: 100, branches: 100 },
        'src/stores/**': { lines: 100, statements: 100, functions: 100, branches: 100 },
        // Hooks are activated surface too (issue #175 — `useHistory` is the
        // App's only transaction-history source of truth): same strict gate.
        'src/hooks/**': { lines: 100, statements: 100, functions: 100, branches: 100 },
        // Route surface (issue #188): every route-component handler is now
        // unit-tested, so pin function coverage at 100 % per-glob. Lines /
        // statements / branches are NOT yet at 100 % here (several render
        // branches and defensive guards remain E2E-only), so only the
        // functions axis is gated — enough to stop an untested handler from
        // landing in a route component, which the global aggregate let slip.
        'src/app/**': { functions: 100 },
        // Security-sensitive E2E proxy (CodeQL: stack-trace-exposure +
        // clear-text-logging were fixed here) — keep every reachable
        // line/branch test-covered so the hardened behaviour cannot
        // silently regress.
        'scripts/e2e-info-proxy.mjs': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
      },
    },
  },
});
