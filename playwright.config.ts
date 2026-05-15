import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Helpers and global-setup files live under e2e/ but should not be
  // picked up as tests. Spec files are numerically prefixed (`0X-*.spec.ts`)
  // plus the legacy `wallet.spec.ts` / `send-flow.spec.ts` / `settings.spec.ts`
  // / `visual.spec.ts` / `webauthn.spec.ts`; underscore-prefixed files
  // (`_global-setup.ts`, `_helpers/*.ts`) are excluded by the glob.
  testMatch: ['*.spec.ts', '*.spec.mjs'],
  // New exhaustive-suite specs are listed here while their linux
  // baselines are missing — the regular CI run ignores them so it
  // doesn't fail on a `Snapshot doesn't exist` error. The regen
  // workflow sets E2E_NEED_FIXTURES=true to opt every new spec back
  // in so the workflow can produce the missing PNGs.
  //
  // Once a spec's snapshots directory is committed, remove its file
  // name from this list. Tracked in e2e/README.md § 11.3.
  //
  // Active specs (baselines committed):
  //   01-onboarding-welcome.spec.ts (PR #18)
  //   02-create-seed.spec.ts        (PR #19)
  //   03-restore-seed.spec.ts       (PR #20)
  testIgnore: process.env.E2E_NEED_FIXTURES === 'true' ? [] : ['04-unlock-password.spec.ts'],
  // Seed Alice + Bob once before any worker starts; remove the fixture
  // file afterwards. See e2e/_global-setup.ts and e2e/_global-teardown.ts.
  globalSetup: require.resolve('./e2e/_global-setup.ts'),
  globalTeardown: require.resolve('./e2e/_global-teardown.ts'),
  timeout: 30_000,
  retries: 1,
  fullyParallel: true,
  reporter: [['html', { open: 'never' }]],

  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://dev.zkcoins.app',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      // Visual regression only in chromium — functional tests in firefox
      grep: /^(?!.*Visual Regression)/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grep: /^(?!.*Visual Regression)/,
    },
  ],
});
