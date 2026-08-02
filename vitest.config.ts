import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@/': path.resolve(__dirname, './src/') + '/',
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
      // Coverage-scope rule — one deterministic criterion, no exceptions:
      //
      //   Code that is NOT behind a `NEXT_PUBLIC_ENABLE_*` build flag is
      //   default-active (it ships and is reachable) and MUST reach 100 %
      //   coverage — unit here, plus e2e. Code behind such a flag is
      //   dead-stripped from the shipped bundle and is exempt. That is the
      //   only exemption: "decorative", "no logic" or "triage:keep" do not
      //   qualify a file for exclusion.
      //
      // The env-gate flag set is the single source of truth in
      // `e2e/_audit/gates.mjs` (`ENV_GATED_FEATURES`) — the same set the
      // button- and golden-coverage audits consume, so unit and e2e scope
      // cannot drift apart.
      exclude: [
        'src/__tests__/**', // the test files themselves
        // Only env-gated files are exempt (behind a NEXT_PUBLIC_ENABLE_* flag,
        // so dead-stripped from the shipped bundle). Everything else is
        // default-active and covered — the DEBT burn-down is complete; do not
        // re-add non-env-gated files here.
        'src/lib/crypto/passkey.ts', // PASSKEY
        'src/app/apps/page.tsx', // APPS_DIRECTORY → notFound()
        'src/app/reset/page.tsx', // DEV_ROUTES → notFound()
      ],
      reporter: ['text', 'lcov'],
      // Coverage thresholds operate at two tiers:
      //
      // 1. `src/lib/**` + `src/stores/**` + `src/hooks/**` — strict 100 %
      //    on every axis. Any new line, statement, branch, or function
      //    that is not exercised by a test fails CI. Defensive code that
      //    genuinely cannot be reached in the unit test environment (SSR
      //    guards, IDB error callbacks, timeout fallbacks) is marked
      //    `/* c8 ignore */` at the source.
      //
      // 2. Global aggregate (includes `src/app/**` + `src/components/**`).
      //    The DEBT exclude list is fully burned down — every default-active
      //    file is now covered, so the only files outside the aggregate are
      //    the env-gated ones above. The floors below sit just under the live
      //    numbers so no regression can drop coverage; they ratchet upward and
      //    never move down. The residual gap to 100 % is the non-function axes
      //    on the app surface (render branches + defensive guards that are
      //    exercised by E2E, not unit).
      //
      //    Issue #188: the `src/app/**` route surface is at 100 % function
      //    coverage (every route-component handler is unit-tested), pinned by
      //    the per-glob `src/app/**` functions:100 gate below.
      thresholds: {
        // Global aggregate over every included file (incl. lib/stores).
        // Ratcheted up after the DEBT burn-down completed (network-activity
        // lib + chart UI, decorative icons, root layout all now covered) —
        // floors sit just under the live numbers and only move upward.
        lines: 92,
        statements: 92,
        functions: 94,
        branches: 85,
        // Strict gate, applied per-glob aggregate. The aggregate over
        // `src/lib/**` (and `src/stores/**`) must be 100 %, which — since
        // aggregate = covered / total — is equivalent to every file in
        // those globs being fully covered.
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
