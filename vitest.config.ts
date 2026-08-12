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
        // E2E-only `/v1/info` proxy. Not app code, but it is security-
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
      //    `/* v8 ignore */` (or legacy `/* c8 ignore */`) at the source.
      //
      // 2. Global aggregate (includes `src/app/**` + `src/components/**`) —
      //    strict 100 % on all four axes for every default-active source.
      thresholds: {
        // Global hard gate over every included default-active file.
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 100,
        // Strict gate, applied per-glob aggregate. The aggregate over
        // `src/lib/**` (and `src/stores/**`) must be 100 %, which — since
        // aggregate = covered / total — is equivalent to every file in
        // those globs being fully covered.
        'src/lib/**': { lines: 100, statements: 100, functions: 100, branches: 100 },
        'src/stores/**': { lines: 100, statements: 100, functions: 100, branches: 100 },
        // Hooks are activated surface too (issue #175 — `useHistory` is the
        // App's only transaction-history source of truth): same strict gate.
        'src/hooks/**': { lines: 100, statements: 100, functions: 100, branches: 100 },
        // Route surface (issue #188): the global aggregate already gates all
        // four axes at 100 %. This per-glob entry is an additional functions
        // guard on `src/app/**` so an untested route-component handler cannot
        // slip through even if other surfaces keep the global average green.
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
