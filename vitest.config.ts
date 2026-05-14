import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@/': path.resolve(__dirname, './src/') + '/',
      '@zkcoins/wasm': path.resolve(__dirname, './packages/zkcoins-wasm/src/index.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
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
    },
  },
});
