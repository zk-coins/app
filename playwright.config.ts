import { defineConfig, devices } from '@playwright/test';

// E2E target selector. Two modes share the *same* spec files and the
// same `*-chromium-linux.png` baselines:
//
//   dev   (default, CI): run against the hosted DEV stack
//                        (https://dev.zkcoins.app + https://dev-api.zkcoins.app).
//                        No webServer — Playwright drives the live deployment.
//                        This is the historical behaviour; leaving E2E_TARGET
//                        unset reproduces it exactly, so CI is untouched.
//
//   local:              run against a locally-served standalone PR build plus
//                        a local zkCoins node (default host.docker.internal:4242).
//                        Orchestrated by `scripts/e2e-local.sh`, which builds the
//                        app with the same-origin proxy config, starts the
//                        standalone server + the test-only `/api/info`
//                        capability-normalisation proxy, then invokes Playwright.
//                        See e2e/README.md § 4.2.
const E2E_TARGET = process.env.E2E_TARGET === 'local' ? 'local' : 'dev';

// In local mode `scripts/e2e-local.sh` has already started the standalone
// server (it bakes `NEXT_PUBLIC_API_URL` / `LOCAL_NODE_PROXY_TARGET` at build
// time, which `next start` would ignore). The webServer block below therefore
// only ever *reuses* that running server — `reuseExistingServer: true` plus a
// no-op command means Playwright never tries to start its own. The app port is
// taken from E2E_LOCAL_APP_PORT (default 3090) and mirrored into E2E_BASE_URL
// by the script.
const LOCAL_APP_PORT = process.env.E2E_LOCAL_APP_PORT || '3090';
const LOCAL_BASE_URL = process.env.E2E_BASE_URL || `http://127.0.0.1:${LOCAL_APP_PORT}`;

const baseURL =
  E2E_TARGET === 'local' ? LOCAL_BASE_URL : process.env.E2E_BASE_URL || 'https://dev.zkcoins.app';

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
  // Staged behind a regen (baselines not yet committed):
  //   14-network-activity.spec.ts       (issue #166) — remove from the
  //   list below in the same commit that lands its
  //   `e2e/14-network-activity.spec.ts-snapshots/` PNGs, so the regular
  //   CI run starts diffing it the moment its baselines exist.
  testIgnore: process.env.E2E_REGENERATING === 'true' ? [] : ['14-network-activity.spec.ts'],
  // Seed Alice + Bob once before any worker starts; remove the fixture
  // file afterwards. See e2e/_global-setup.ts and e2e/_global-teardown.ts.
  globalSetup: require.resolve('./e2e/_global-setup.ts'),
  globalTeardown: require.resolve('./e2e/_global-teardown.ts'),
  timeout: 30_000,
  retries: 1,
  fullyParallel: true,
  reporter: [['html', { open: 'never' }]],

  // Local mode only: reuse the standalone server `scripts/e2e-local.sh`
  // already started. The command is a no-op (`true`) because the build
  // bakes `NEXT_PUBLIC_API_URL` / `rewrites()` at build time, which a
  // Playwright-spawned `next start` would ignore (Next standalone applies
  // rewrites only via `node server.js`). `reuseExistingServer: true` makes
  // Playwright skip the command entirely when the URL is already up, which
  // it always is here — the block exists purely so Playwright waits for /
  // health-checks the base URL before the first navigation. Omitted in dev
  // mode so the hosted-stack behaviour is byte-for-byte unchanged.
  ...(E2E_TARGET === 'local'
    ? {
        webServer: {
          command: 'true',
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }
    : {}),

  use: {
    baseURL,
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
