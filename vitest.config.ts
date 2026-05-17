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
      include: ['src/lib/**', 'src/stores/**'],
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
      ],
      reporter: ['text', 'lcov'],
      // Coverage baseline for the MVP activated surface: strict 100% on
      // every axis. Any new line, statement, branch, or function in
      // `src/lib/**` or `src/stores/**` that is not exercised by a test
      // fails CI. Defensive code that genuinely cannot be reached in the
      // unit test environment (SSR guards, IDB error callbacks, timeout
      // fallbacks) is marked `/* c8 ignore */` at the source.
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
});
