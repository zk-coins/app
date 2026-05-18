import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Helpers and global-setup files live under e2e/ but should not be
  // picked up as tests. Spec files are numerically prefixed
  // (`{01..11}-*.spec.ts`) plus the still-active legacy `webauthn.spec.ts`
  // (non-MVP DEV-bundle passkey coverage). Underscore-prefixed files
  // (`_global-setup.ts`, `_helpers/*.ts`) are excluded by the glob.
  //
  // Retired legacy specs (replaced by the exhaustive 01..11 suite):
  //   visual.spec.ts        — replaced in PR-3 (02-create-seed)
  //   wallet.spec.ts        — replaced by 01-onboarding + 02-create-seed + 03-restore-seed + 06-balance + 09-network-and-shell
  //   send-flow.spec.ts     — replaced by 06-balance + 07-send + 08-receive
  //   settings.spec.ts      — replaced by 05-disconnect + 09-network-and-shell
  testMatch: ['*.spec.ts', '*.spec.mjs'],
  // New exhaustive-suite specs are listed here while their linux
  // baselines are missing — the regular CI run ignores them so it
  // doesn't fail on a `Snapshot doesn't exist` error. The regen
  // workflow sets E2E_REGENERATING=true to opt every new spec back
  // in so the workflow can produce the missing PNGs.
  //
  // E2E_REGENERATING is intentionally separate from E2E_NEED_FIXTURES:
  // the regular CI job sets E2E_NEED_FIXTURES=true (so globalSetup
  // mints Alice+Bob for the *already-active* specs), but NOT
  // E2E_REGENERATING (so testIgnore still excludes pending specs).
  // Only the regen workflow sets both.
  //
  // Once a spec's snapshots directory is committed, remove its file
  // name from this list. Tracked in e2e/README.md § 11.3.
  //
  // Active specs (baselines committed):
  //   01-onboarding-welcome.spec.ts     (PR #18)
  //   02-create-seed.spec.ts            (PR #19)
  //   03-restore-seed.spec.ts           (PR #20)
  //   04-unlock-password.spec.ts        (PR #21)
  //   05-disconnect.spec.ts             (PR #22)
  //   06-balance.spec.ts                (PR #23)
  //   07-send.spec.ts                   (PR #24)
  //   08-receive.spec.ts                (PR #25)
  //   09-network-and-shell.spec.ts      (PR #26)
  //   10-pwa.spec.ts                    (PR #27)
  //   11-cross-spec-redirects.spec.ts   (PR #27)
  //
  // All exhaustive specs are now active. The testIgnore array is empty
  // outside of `E2E_REGENERATING`. We keep the conditional in place
  // (rather than removing the field) so a future spec PR has a clear
  // place to stage itself behind a regen.
  testIgnore: process.env.E2E_REGENERATING === 'true' ? [] : [],
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
