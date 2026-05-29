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
      include: ['src/lib/**', 'src/stores/**', 'src/components/**', 'src/app/**'],
      // Exclude code paths that are not part of the MVP activated surface.
      // The PRD bundle is built with every NEXT_PUBLIC_ENABLE_* flag off, so
      // these files are unreachable from any user-facing route and we don't
      // require unit coverage on them. The Network Activity chart is `keep`-
      // tagged in the triage and never exercised in the MVP path either.
      exclude: [
        'src/__tests__/**',
        'src/lib/crypto/passkey.ts', // gated by NEXT_PUBLIC_ENABLE_PASSKEY
        'src/lib/simulate.ts', // gated by NEXT_PUBLIC_ENABLE_DEV_ROUTES
        'src/lib/simulate-network.ts', // network activity chart (triage: keep)
        'src/lib/api/explorer.ts', // network activity chart (triage: keep)
        // App + component surface exclusions:
        'src/app/layout.tsx', // Next.js root layout, no logic
        'src/app/apps/page.tsx', // FEATURES.APPS_DIRECTORY → notFound() in PRD
        'src/app/simulate/page.tsx', // FEATURES.DEV_ROUTES → notFound() in PRD
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
      //    fails CI, without forcing every page.tsx to ship with a
      //    unit-level component test before the rest of the audit
      //    is closed. Raise these as more tests land.
      thresholds: {
        // Global aggregate over every included file (incl. lib/stores).
        lines: 75,
        statements: 75,
        functions: 75,
        branches: 60,
        // Original strict gate, applied per-glob aggregate. The
        // aggregate over `src/lib/**` (and `src/stores/**`) must be
        // 100 %, which — since aggregate = covered / total — is
        // equivalent to every file in those globs being fully
        // covered, matching the prior per-file invariant.
        'src/lib/**': { lines: 100, statements: 100, functions: 100, branches: 100 },
        'src/stores/**': { lines: 100, statements: 100, functions: 100, branches: 100 },
      },
    },
  },
});
