# E2E + Visual Regression Plan

Status: **planning** — no code in this plan has been implemented yet. This document is the working contract between human reviewers and any agent (Claude session, human contributor, CI worker) that picks up the work. Every implementation PR must reference the section it satisfies.

## 1. Goal

Cover **every single MVP user step** of the zkCoins web app with:

1. A functional Playwright assertion (the step actually works against a real server)
2. A **screenshot baseline** that fails CI on any visual regression

"Every step" means: every button that can be clicked, every form state the user can reach, every screen that gets rendered. No exceptions for the 10 MVP functions listed below.

Non-MVP code (passkey, faucet, usernames, apps, dev-routes) is build-time dead-stripped from the PRD bundle (`FEATURES.*` in `src/lib/features.ts`). It is **out of scope** for this plan but kept in `e2e/webauthn.spec.ts` etc. for the DEV bundle.

### 1.1 MVP functions in scope

The exhaustive list — these are the 10 `triage: mvp` rows from `README.md § Features`:

1. Create wallet — seed phrase
2. Restore wallet — seed phrase
3. Unlock wallet — password
4. Disconnect wallet
5. View balance
6. View transaction history
7. Send Bitcoin (2-phase)
8. Receive Bitcoin (address + QR)
9. Network info badge
10. Install as PWA *(triage gap — see §10)*

## 2. Current state (2026-05-15)

What exists today in `e2e/`:

| Spec                  | Lines | Screenshots | Notes                                            |
| --------------------- | ----- | ----------- | ------------------------------------------------ |
| `visual.spec.ts`      | 89    | 4 tests / 6 darwin baselines / 6 linux baselines | Landing × 3 viewports, seed setup, mnemonic, seed import |
| `wallet.spec.ts`      | 57    | 0           | Functional onboarding click-throughs             |
| `send-flow.spec.ts`   | 142   | 0           | Wallet display, send page, receive page          |
| `settings.spec.ts`    | 101   | 0           | Settings nav + disconnect                        |
| `webauthn.spec.ts`    | 132   | 0           | **Non-MVP** — passkey flow (gated)               |
| `screenshot-flow.mjs` | —     | n/a         | Ad-hoc script, not a Playwright spec             |

**Diagnosis**: ~10% of MVP steps have screenshot baselines, ~70% have functional E2E, two MVP functions (Unlock-password, PWA) have neither.

## 3. Decisions (locked)

| # | Decision                                | Value                                                                                                        | Why                                                                                                                                                            |
| - | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Test target                             | Real server (default: DEV at `https://dev.zkcoins.app`) — overridable via `E2E_BASE_URL`/`E2E_API_URL`       | True end-to-end; no mock/real divergence. DEV/PRD switchable in config.                                                                                        |
| 2 | Determinism                             | `globalSetup` creates **two fresh random accounts (Alice + Bob)** before every run                            | Every step starts from a byte-identical state across runs except the on-chain address. Wallet addresses are masked in every screenshot.                        |
| 3 | Baseline platforms                      | **Linux only**, generated in CI                                                                              | Halves baseline count to ~47. Developers can compare locally but only CI produces canonical PNGs.                                                              |
| 4 | Cross-spec wallet sharing               | Onboarding specs create their own throwaway wallets. Send/Receive/Balance/Tx specs reuse Alice + Bob.        | Onboarding flows must start from a blank slate; everything else benefits from shared setup speed.                                                              |
| 5 | Masks for non-deterministic content     | Addresses (`{8hex}@zkcoins.app`), mnemonic word grid, balance numbers from server, ISO timestamps, copy hash | Anything that varies between runs is masked at the locator level so the rest of the screen is pixel-checked.                                                   |
| 6 | Screenshot tolerance                    | `maxDiffPixelRatio: 0.01`, `animations: 'disabled'`, `caret: 'hide'`, `scale: 'css'`                          | Already the project default in `playwright.config.ts`. We keep it tight — 1% lets through font-rendering jitter but flags any real UI change.                  |
| 7 | One spec per MVP function               | `01-create-seed.spec.ts` … `10-pwa.spec.ts`                                                                  | Numeric prefixes drive a stable run order. Failure points to a single function. PRs stay small.                                                                |
| 8 | Helper layout                           | `e2e/_helpers/{api.ts, wallet.ts, screenshot.ts, fixtures.ts}`                                               | Underscore prefix keeps helpers out of `testDir` glob. Specs only import from these helpers — no copy-pasted setup.                                            |
| 9 | Baseline-regen workflow                 | `.github/workflows/regenerate-visual-baselines.yml` on `workflow_dispatch`                                   | Manual trigger only. Auto-commits new PNGs to the triggering branch. Prevents accidental baseline overwrites on every push.                                    |

## 4. Configuration

`E2E_BASE_URL` and `E2E_API_URL` already drive the existing `playwright.config.ts`. The new helpers add:

| Env var                  | Default                      | Purpose                                                                       |
| ------------------------ | ---------------------------- | ----------------------------------------------------------------------------- |
| `E2E_BASE_URL`           | `https://dev.zkcoins.app`    | Frontend under test. Switch to `https://zkcoins.app` for PRD.                 |
| `E2E_API_URL`            | `https://dev-api.zkcoins.app` | Backend the helpers talk to directly (faucet, balance polling).               |
| `E2E_NETWORK_EXPECTED`   | `signet`                     | Network the badge should show. Asserted in `09-network-badge.spec.ts`.        |
| `E2E_FAUCET_AMOUNT_SATS` | `100000` (= 0.001 BTC)       | Pre-funded sats per fresh Alice account. PRD ignores (faucet flag off there). |
| `E2E_KEEP_ACCOUNTS`      | unset                        | If `true`, `globalTeardown` skips wiping fixtures (useful for debugging).     |

PRD switch: `E2E_BASE_URL=https://zkcoins.app E2E_API_URL=https://api.zkcoins.app playwright test`. Specs that depend on the faucet (only the onboarding seeding helper) detect mainnet via `/api/info` and abort with a clear message — they cannot run against PRD by design.

## 5. Global setup — fresh accounts every run

File: `e2e/_global-setup.ts`. Runs once before all workers start.

```text
1. Generate two random 24-word mnemonics (use the wasm bridge in src/lib/crypto so
   we hit the same path the app uses — DRY, and any bug in the bridge surfaces here too).
2. Derive Alice + Bob accounts (xpub_0 / xpub_1) without going through the UI.
3. Call POST /api/mint to seed Alice with E2E_FAUCET_AMOUNT_SATS. Retry × 3, exp backoff.
   Bob stays empty so we have one funded and one zero-balance fixture.
4. Persist {alice: {mnemonic, address}, bob: {mnemonic, address}} to
   e2e/.fixtures/accounts.json (gitignored — see .gitignore in step 12.1).
5. Print "Alice 0x… (100000 sats)  Bob 0x… (0 sats)" so CI logs show what was used.
```

`e2e/_global-teardown.ts`:

```text
1. Read e2e/.fixtures/accounts.json.
2. If E2E_KEEP_ACCOUNTS is unset, unlink the file. Accounts on-chain stay
   (server has no delete endpoint) — that's fine, they're random and unfunded.
```

Why two accounts and not one: `07-send.spec.ts` and `06-transactions.spec.ts` need a real on-chain send between two real wallets — Alice → Bob — to populate Bob's transaction list. Self-send is rejected by the server.

## 6. Helper API

All paths relative to `e2e/`.

### `_helpers/api.ts`

```ts
export const api = {
  info(): Promise<InfoResponse>;
  balance(addressHex: string): Promise<BalanceResponse>;
  mint(addressHex: string, sats: number): Promise<SendResponse>;
  // No send/commit helpers — send is exercised through the UI.
};
```

Uses `node-fetch` (or undici, Node ≥ 20 ships it). Targets `E2E_API_URL`.

### `_helpers/wallet.ts`

```ts
// UI-driven helpers — drive the same flow the user does.
export async function createSeedWallet(page: Page, password = 'TestPass123!'): Promise<{
  mnemonic: string[];      // captured from the reveal screen
  address: string;         // {8hex}@zkcoins.app
}>;

export async function restoreSeedWallet(page: Page, mnemonic: string[], password: string): Promise<void>;

export async function unlockWithPassword(page: Page, password: string): Promise<void>;

export async function disconnect(page: Page): Promise<void>;

// State helpers — bypass the UI when the spec only needs a precondition.
export async function loadAliceInBrowser(page: Page): Promise<void>; // reads fixtures, calls saveWithPassword
export async function loadBobInBrowser(page: Page): Promise<void>;
export async function clearWalletState(page: Page): Promise<void>;
```

### `_helpers/screenshot.ts`

```ts
export async function snap(
  page: Page | Locator,
  name: string,
  opts?: { mask?: Locator[]; fullPage?: boolean; viewport?: 'desktop' | 'mobile' }
): Promise<void>;
```

The `snap` helper always:

- Sets viewport (default 1440 × 900 desktop, 375 × 812 mobile).
- Waits for `networkidle`.
- Waits for fonts (`document.fonts.ready`).
- Applies the default mask set (see §7).
- Calls `expect(target).toHaveScreenshot(name + '.png', { mask: [...defaultMasks, ...customMasks] })`.

### `_helpers/fixtures.ts`

```ts
export function readAccounts(): { alice: Account; bob: Account };
export function aliceLogin(page: Page, password: string): Promise<void>; // restoreSeedWallet + unlock
export function bobLogin(page: Page, password: string): Promise<void>;
```

## 7. Screenshot conventions

### Default masks (applied by `snap` to every shot)

| Locator                                                          | What it hides                          |
| ---------------------------------------------------------------- | -------------------------------------- |
| `text=/[0-9a-f]{8}@zkcoins\.app/`                                | Wallet address chip                    |
| `[data-testid="balance-value"]`                                  | Numeric BTC balance                    |
| `[data-testid="tx-amount"]`                                      | Transaction row amounts                |
| `[data-testid="tx-time"]`                                        | Transaction row timestamps             |
| `[data-testid="seed-grid"]`                                      | The 24 mnemonic words                  |
| `[data-testid="qr-code"]`                                        | The receive QR (depends on address)    |
| `[data-testid="copy-hash"]`                                      | The "copied 0xabc…" toast              |

**Action item**: every locator above must exist in the app. Specs file PRs add the `data-testid` attribute alongside the test that needs it. No `data-testid` proliferation — only when a screenshot can't otherwise be stable.

### File naming

`<spec-prefix>-<step-slug>.png` — e.g. `01-create-seed-mnemonic-revealed.png`. Slugs are kebab-case and stable; renaming a step renames its baseline (review must call this out).

### Viewport

Default desktop 1440 × 900. Mobile 375 × 812 is captured **only for**:

- Landing (`00-landing-mobile.png`)
- Wallet main screen (`05-wallet-mobile.png`)
- Send confirm dialog (`07-send-confirm-mobile.png`)
- Receive screen (`08-receive-mobile.png`)

Other screens are desktop-only — going wider doesn't add value to a regression gate.

## 8. Test inventory (the complete step list)

Each row below becomes a `test()` block. Naming convention: `<step-slug>` (lowercase). Every test takes one screenshot at the end of its body unless marked `(no shot)`.

### 8.1 `01-create-seed.spec.ts` (10 tests / 9 shots)

| # | Step                                                   | Notes                                                                |
| - | ------------------------------------------------------ | -------------------------------------------------------------------- |
| 1 | landing-desktop                                        | Replace today's `landing-desktop` baseline.                          |
| 2 | landing-mobile                                         | Replace today's `landing-mobile`. Drop `landing-tablet` baseline.    |
| 3 | passkey-intro                                          | After clicking CREATE WALLET. The `OTHER LOGIN OPTIONS` link visible. |
| 4 | seed-reveal-hidden                                     | After OTHER LOGIN OPTIONS. The "Tap to reveal" tile.                 |
| 5 | seed-reveal-shown                                      | After clicking "Tap to reveal". Mnemonic grid masked.                |
| 6 | seed-acknowledged                                      | After "I've written it down". Continue enabled.                      |
| 7 | password-empty                                         | After Continue. Both password inputs empty, "Create wallet" disabled. |
| 8 | password-filled                                        | After typing matching passwords. Button enabled.                     |
| 9 | wallet-created                                         | After Create wallet click. Landed on `/`. Empty wallet banner visible. |
|10 | clears-state-on-rerun (no shot)                        | Sanity assertion that a second wallet creation overwrites the first. |

### 8.2 `02-restore-seed.spec.ts` (7 tests / 6 shots)

| # | Step                            | Notes                                                                                     |
| - | ------------------------------- | ----------------------------------------------------------------------------------------- |
| 1 | restore-entry                   | After "Restore existing wallet" on landing.                                               |
| 2 | mnemonic-input-empty            | The 24-word input grid.                                                                   |
| 3 | mnemonic-input-filled-valid     | Pre-filled with Alice's mnemonic. "Continue" enabled.                                     |
| 4 | mnemonic-input-filled-invalid   | Pre-filled with garbage. Error visible, Continue disabled.                                |
| 5 | restore-password-empty          | Password setup after Continue.                                                            |
| 6 | restore-password-filled         | Matching passwords typed.                                                                 |
| 7 | restored-wallet                 | Lands on `/`, wallet view, balance ≥ 0 (masked).                                          |

### 8.3 `03-unlock-password.spec.ts` (4 tests / 4 shots)

| # | Step                | Notes                                                                                       |
| - | ------------------- | ------------------------------------------------------------------------------------------- |
| 1 | unlock-screen-empty | Cold start with Alice in IDB. UnlockScreen visible.                                         |
| 2 | unlock-typed        | Password field filled.                                                                       |
| 3 | unlock-wrong-error  | After clicking unlock with wrong password. Error message visible.                            |
| 4 | unlocked            | After correct password — wallet view.                                                        |

Closes the **MVP triage gap** noted in `README.md`.

### 8.4 `04-disconnect.spec.ts` (4 tests / 4 shots)

| # | Step               | Notes                                                                       |
| - | ------------------ | --------------------------------------------------------------------------- |
| 1 | settings-from-wallet | After clicking the settings link in the wallet.                          |
| 2 | settings-page      | Full settings render.                                                       |
| 3 | disconnect-confirm | After clicking Disconnect — confirm dialog (`window.confirm` stubbed via `page.on('dialog')`). |
| 4 | post-disconnect    | After confirming — landed on `/`, landing visible.                          |

### 8.5 `05-balance.spec.ts` (3 tests / 3 shots)

| # | Step             | Notes                                                       |
| - | ---------------- | ----------------------------------------------------------- |
| 1 | balance-funded   | Alice (has sats). Balance + USD value masked.               |
| 2 | balance-hidden   | After eye toggle. Balance area shows dots/hidden marker.    |
| 3 | balance-zero     | Bob (no sats). Empty-wallet banner.                          |

Plus one mobile shot: `05-wallet-mobile.png` (Alice).

### 8.6 `06-transactions.spec.ts` (3 tests / 3 shots)

| # | Step                | Notes                                                                                                      |
| - | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1 | tx-list-empty       | Bob, "No transactions yet".                                                                                |
| 2 | tx-list-after-send  | Bob, after Alice sent him 1000 sats earlier in the run (depends on `07-send`). Single row visible, masked. |
| 3 | tx-row-types        | Alice, after a self-mint + outbound send. Verifies icon variants (in vs out vs faucet).                    |

This spec depends on `07-send` having run earlier. Playwright honours alphabetic ordering by file name, so `06 < 07` is fine **if** we restructure to run `07` first or split the tx-after-send assertion into `07`. **Decision**: move tx-after-send check into the end of `07-send.spec.ts`, keep `06` to empty + manual-fixture seeding via a server-side mint.

### 8.7 `07-send.spec.ts` (10 tests / 9 shots, 1 no-shot)

| #  | Step                       | Notes                                                                                    |
| -- | -------------------------- | ---------------------------------------------------------------------------------------- |
| 1  | send-empty                 | `/send` initial. Send button disabled.                                                   |
| 2  | recipient-valid            | Address pasted. Send still disabled (no amount).                                         |
| 3  | recipient-invalid          | Garbage in recipient. Error message visible.                                             |
| 4  | amount-filled              | Both fields valid. Send enabled.                                                         |
| 5  | amount-insufficient        | Amount > balance. Error visible.                                                         |
| 6  | confirm-dialog             | After Send click. Dialog with recipient + amount.                                        |
| 7  | confirm-dialog-mobile      | Mobile viewport screenshot of the dialog (small-screen layout often regresses).          |
| 8  | sending                    | After confirm — loading state. Capture before the round-trip finishes (`waitForResponse`). |
| 9  | success                    | After server confirms — wallet view with new TX row.                                     |
| 10 | post-send-tx-row (no shot) | Assertion: Bob's tx list now shows the inbound row (set up via `loadBobInBrowser`).      |

### 8.8 `08-receive.spec.ts` (3 tests / 3 shots)

| # | Step               | Notes                                                                  |
| - | ------------------ | ---------------------------------------------------------------------- |
| 1 | receive-default    | `/receive` rendered. QR + address chip masked.                          |
| 2 | receive-mobile     | Same, mobile viewport.                                                  |
| 3 | receive-after-copy | After "Copy address" click. Toast visible (with copy-hash masked).      |

### 8.9 `09-network-badge.spec.ts` (2 tests / 2 shots)

| # | Step                   | Notes                                                                                                    |
| - | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| 1 | badge-signet           | `E2E_NETWORK_EXPECTED=signet` (DEV default). Asserts badge text + screenshot of the badge component only. |
| 2 | badge-loading          | Before `/api/info` resolves — intercept and delay 1 s. Asserts the placeholder state.                    |

No mainnet shot here (we don't run E2E against PRD in CI by default; the assertion belongs in PRD smoke tests).

### 8.10 `10-pwa.spec.ts` (1 test / 1 shot)

| # | Step                       | Notes                                                                                                                                                                  |
| - | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | install-prompt-fired       | Dispatch a synthetic `beforeinstallprompt` event in the page, assert the app exposes/saves the deferred-prompt + the install button (if present in UI). Screenshot the install affordance. |

Real install prompt is browser-controlled and cannot be reliably triggered headless. This is the best automated coverage available; mark with a comment that closes the triage gap pragmatically rather than perfectly.

### 8.11 Existing `visual.spec.ts` retirement

After steps 8.1–8.10 are in: delete `visual.spec.ts` and its `visual.spec.ts-snapshots/` directory in the same PR that introduces `01-create-seed.spec.ts`. The new spec is a superset of every shot the old one had.

### 8.12 Totals

| Bucket                       | Tests | Screenshots (linux only) |
| ---------------------------- | ----- | ------------------------ |
| 01 create-seed               | 10    | 9 + 1 mobile = 10        |
| 02 restore-seed              | 7     | 6                        |
| 03 unlock-password           | 4     | 4                        |
| 04 disconnect                | 4     | 4                        |
| 05 balance                   | 3     | 3 + 1 mobile = 4         |
| 06 transactions              | 3     | 3                        |
| 07 send                      | 10    | 9 + 1 mobile = 10        |
| 08 receive                   | 3     | 2 + 1 mobile = 3         |
| 09 network-badge             | 2     | 2                        |
| 10 pwa                       | 1     | 1                        |
| **Σ**                        | **47**| **49**                   |

49 linux baselines total. If decision #3 ever flips to "linux + darwin", multiply by 2.

## 9. CI integration

### 9.1 Two new jobs in `.github/workflows/ci.yaml`

```text
jobs:
  e2e-visual:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    needs: lint-and-build
    env:
      E2E_BASE_URL: https://dev.zkcoins.app
      E2E_API_URL:  https://dev-api.zkcoins.app
      E2E_NETWORK_EXPECTED: signet
      E2E_FAUCET_AMOUNT_SATS: '100000'
    steps:
      - checkout
      - setup-node 22
      - npm ci
      - npx playwright install --with-deps chromium
      - npx playwright test --project=chromium  # runs everything in e2e/0*
      - upload diff report on failure (actions/upload-artifact)
```

### 9.2 Baseline regeneration workflow

`.github/workflows/regenerate-visual-baselines.yml`:

```text
on:
  workflow_dispatch:
    inputs:
      branch:
        description: Branch to update baselines on
        required: true

jobs:
  regen:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    permissions:
      contents: write
    steps:
      - checkout (ref = inputs.branch)
      - setup-node 22; npm ci; playwright install
      - npx playwright test --update-snapshots
      - git add e2e/*.spec.ts-snapshots/
      - git commit -m "test(e2e): regenerate visual baselines"
      - git push origin HEAD:${{ inputs.branch }}
```

Branch protection on `develop` and `main` must allow this workflow's bot push.

### 9.3 PR gating

`e2e-visual` joins the existing required-checks list. Once the workflow is green on `develop`, branch protection enforces it.

## 10. Triage gaps and explicit non-coverage

- **PWA install**: §8.10 covers the deferred-prompt save path. The native browser prompt cannot be exercised headless. We accept this gap and document it here.
- **Account creation crypto**: tested in unit tests (`src/__tests__/lib/crypto/*`) at 100%. Not re-tested at the E2E layer for individual byte values — E2E only proves "wallet exists and is functional after Create".
- **Faucet flow** (`Mint test BTC` button): non-MVP, gated, but exists in the DEV build. We **do not** add a screenshot spec for it — it's exercised indirectly by the `globalSetup` faucet call, which fails the whole suite if `/api/mint` regresses.
- **Network-activity chart**: triage `keep`, non-MVP. Covered in `visual.spec.ts` today; the new specs drop it (no longer in the MVP file list).

## 11. Workflow for developers (and future Claude sessions)

### 11.1 Adding a new MVP feature

1. Add the feature to `README.md § Features` (mvp row).
2. Add a step to the relevant spec or a new spec file in this plan (update §8 and the totals in §8.12).
3. Implement the test. Add `data-testid` to the component only if a screenshot can't otherwise be stable (see §7).
4. Run the baseline regen workflow on the feature branch.
5. PR with `e2e-visual` green.

### 11.2 Changing an existing MVP screen

1. Implement the UI change.
2. Run `npm run e2e -- --update-snapshots` locally (will fail because no local linux baseline by design, but the screenshot diff in the failure report shows what changed).
3. Dispatch `regenerate-visual-baselines.yml` on the feature branch.
4. Review the auto-commit's PNG diffs in the PR. Approve = visual change accepted.

### 11.3 Picking up this plan as a fresh Claude session

The implementation order **matters** because later specs depend on earlier helpers:

1. **PR-1**: §6 helpers (`_helpers/api.ts`, `_helpers/wallet.ts`, `_helpers/screenshot.ts`, `_helpers/fixtures.ts`), §5 global setup/teardown, `.gitignore` rule for `e2e/.fixtures/`. No specs yet. CI still green because the new files aren't picked up by `testDir` until they live under `e2e/*.spec.ts`.
2. **PR-2**: §8.1 `01-create-seed.spec.ts`. Retires `visual.spec.ts` in the same PR. Adds `data-testid` for the masks in §7.
3. **PR-3**: §8.2 `02-restore-seed.spec.ts`. Wires up `fixtures.aliceLogin` test reuse.
4. **PR-4**: §8.3 `03-unlock-password.spec.ts` *(closes triage gap)*.
5. **PR-5**: §8.4 `04-disconnect.spec.ts`.
6. **PR-6**: §8.5 `05-balance.spec.ts` + mobile shot.
7. **PR-7**: §8.7 `07-send.spec.ts` (note: before 06, because 06 depends on send having run).
8. **PR-8**: §8.6 `06-transactions.spec.ts`. Reorders the tx-after-send check into 07 if necessary (see §8.6 decision).
9. **PR-9**: §8.8 `08-receive.spec.ts`.
10. **PR-10**: §8.9 `09-network-badge.spec.ts`.
11. **PR-11**: §8.10 `10-pwa.spec.ts` *(closes triage gap)*.
12. **PR-12**: §9 CI integration — `e2e-visual` job + `regenerate-visual-baselines.yml`. Last so the gate only flips on a fully passing suite.

Each PR:

- Adds **only the spec it's labelled with** plus any unblocking helper change.
- Runs `regenerate-visual-baselines.yml` once to commit the linux baselines.
- Updates §8.12 totals in this file when the spec lands.
- Is reviewed for the screenshot diff in the auto-commit by a human (or, for autonomous Claude work, by the next reviewer).

If a PR can't reach green inside 25 minutes of CI: don't merge, downgrade to focused work; do **not** raise the timeout.

## 12. File layout (final state after PR-12)

```
e2e/
├── README.md                          # this document
├── _global-setup.ts                   # §5
├── _global-teardown.ts                # §5
├── _helpers/
│   ├── api.ts                         # §6.1
│   ├── fixtures.ts                    # §6.4
│   ├── screenshot.ts                  # §6.3
│   └── wallet.ts                      # §6.2
├── .fixtures/                         # gitignored — written by global setup
│   └── accounts.json
├── 01-create-seed.spec.ts             # §8.1
├── 01-create-seed.spec.ts-snapshots/  # linux PNGs
├── 02-restore-seed.spec.ts
├── 02-restore-seed.spec.ts-snapshots/
├── 03-unlock-password.spec.ts
├── 03-unlock-password.spec.ts-snapshots/
├── 04-disconnect.spec.ts
├── 04-disconnect.spec.ts-snapshots/
├── 05-balance.spec.ts
├── 05-balance.spec.ts-snapshots/
├── 06-transactions.spec.ts
├── 06-transactions.spec.ts-snapshots/
├── 07-send.spec.ts
├── 07-send.spec.ts-snapshots/
├── 08-receive.spec.ts
├── 08-receive.spec.ts-snapshots/
├── 09-network-badge.spec.ts
├── 09-network-badge.spec.ts-snapshots/
├── 10-pwa.spec.ts
├── 10-pwa.spec.ts-snapshots/
└── webauthn.spec.ts                   # unchanged — non-MVP DEV bundle coverage
```

### 12.1 `.gitignore` addition

```
e2e/.fixtures/
```

## 13. Open questions to flag in PR-1

Things that the plan **does not** yet pin down — surface them in PR-1's description so the reviewer can make a call:

- **Confirm dialog** for Disconnect: today it's `window.confirm`. If the redesign replaces it with an in-app modal, the `04-disconnect.spec.ts` `disconnect-confirm` screenshot has to switch from `page.on('dialog')` to a real DOM screenshot. Track in PR-5.
- **Mobile baselines for restore/unlock**: §7 doesn't list them. If a redesign breaks the small-viewport login flow, this plan won't catch it. Reviewer can opt to add them — that's +3 baselines.
- **Toast component**: every "copied" toast in the app currently uses the same component. If §8.8.3 catches a regression, look at the component, not the spec.
