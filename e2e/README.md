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
| 3  | Baseline platforms                      | **Linux only**, generated in CI                                                                              | Halves baseline count to 74. Developers can compare locally but only CI produces canonical PNGs.                                                              |
| 4  | Cross-spec wallet sharing               | Onboarding specs create their own throwaway wallets. Send / Receive / Balance / Disconnect specs reuse Alice + Bob. | Onboarding flows must start from a blank slate; everything else benefits from shared setup speed.                                                              |
| 5  | Masks for non-deterministic content     | Addresses (`{8hex}@zkcoins.app`), mnemonic word grid, balance numbers from server, ISO timestamps, copy hash, QR code | Anything that varies between runs is masked at the locator level so the rest of the screen is pixel-checked.                                                   |
| 6  | Screenshot tolerance                    | `maxDiffPixelRatio: 0.01`, `animations: 'disabled'`, `caret: 'hide'`, `scale: 'css'`                          | Already the project default in `playwright.config.ts`. We keep it tight — 1% lets through font-rendering jitter but flags any real UI change.                  |
| 7  | One spec per MVP function               | `01-onboarding-welcome.spec.ts` … `11-cross-spec-redirects.spec.ts` (11 files)                               | Numeric prefixes drive a stable run order. Failure points to a single function. PRs stay small.                                                                |
| 8  | Helper layout                           | `e2e/_helpers/{api.ts, wallet.ts, screenshot.ts, fixtures.ts}`                                               | Underscore prefix keeps helpers out of `testDir` glob. Specs only import from these helpers — no copy-pasted setup.                                            |
| 9  | Baseline-regen workflow                 | `.github/workflows/regenerate-visual-baselines.yml` on `workflow_dispatch`                                   | Manual trigger only. Auto-commits new PNGs to the triggering branch. Prevents accidental baseline overwrites on every push.                                    |
| 10 | Parallelism                             | Spec files run in parallel via Playwright's default `fullyParallel: true`. Per-test isolation is per-browser-context, which gives each test its own IndexedDB. | `aliceLogin` / `bobLogin` write the shared fixture into the *test's* context, never a shared global. No cross-test interference.                                |

## 4. Configuration

`E2E_BASE_URL` and `E2E_API_URL` already drive the existing `playwright.config.ts`. The new helpers add:

| Env var                | Default                       | Purpose                                                                                                       |
| ---------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `E2E_BASE_URL`         | `https://dev.zkcoins.app`     | Frontend under test. Switch to `https://zkcoins.app` for PRD.                                                 |
| `E2E_API_URL`          | `https://dev-api.zkcoins.app` | Backend the helpers talk to directly (faucet, balance polling).                                               |
| `E2E_NETWORK_EXPECTED` | `signet`                      | Network the badge should show. Asserted in `09-network-and-shell.spec.ts`.                                    |
| `E2E_FAUCET_CALLS`     | `1`                           | Number of `/api/mint` calls used to seed Alice (the server controls the per-call amount). Set to 0 to skip seeding for a custom run. |
| `E2E_KEEP_ACCOUNTS`    | unset                         | If `true`, `globalTeardown` skips wiping fixtures (useful for debugging).                                     |

PRD switch: `E2E_BASE_URL=https://zkcoins.app E2E_API_URL=https://api.zkcoins.app playwright test`. The plan deliberately does **not** support PRD: the server has the faucet feature off and `globalSetup` would refuse to seed Alice. The `06-balance.spec.ts:balance-zero-faucet-visible` and `06-balance.spec.ts:balance-faucet-minting` shots also assume DEV. A PRD smoke pass is a separate workstream (see §13).

### 4.1 `playwright.config.ts` wiring

PR-1 amends the existing config with three additions:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // ↓ NEW: global setup runs once before any worker starts.
  globalSetup: require.resolve('./e2e/_global-setup.ts'),
  globalTeardown: require.resolve('./e2e/_global-teardown.ts'),
  // existing fields preserved …
});
```

The existing `fullyParallel: true`, `retries: 1`, and 30 s per-test timeout stay put. The new helpers must respect them — no `test.describe.configure({ mode: 'serial' })` unless a spec genuinely needs it.

## 5. Global setup — fresh accounts every run

File: `e2e/_global-setup.ts`. Runs once before any worker starts. Linked from `playwright.config.ts` (see §4.1).

```text
1. Generate two random 12-word BIP-39 mnemonics using the same WASM bridge the app
   uses (`@zkcoins/wasm::generateMnemonic`). DRY, and any bug in the bridge surfaces
   here too. 12 words matches the placeholder text in SeedImportFlow and the
   length validated by `wasm.validateMnemonic`.
2. Derive Alice + Bob accounts via `wasm.createAccountFromMnemonic(phrase)` —
   returns `{ address, numPubkeys, xpriv }` exactly like the app.
3. Seed Alice: call POST /api/mint with Alice's address E2E_FAUCET_CALLS times.
   The server controls the per-call amount; we observe the resulting balance via
   GET /api/balance and store it (`alice.seededBalance`). Retry × 3 with exp backoff.
   Bob is **not** funded — having one zero-balance fixture is required for
   06-balance:balance-zero-faucet-visible and the No-funds banner in 07-send.
4. Poll GET /api/balance for Alice until balance > 0 (max 30 s). Server commits
   the mint inscription asynchronously — without this poll, the first Wallet
   screenshot races the polling tick.
5. Persist {alice: {mnemonic, address, seededBalance}, bob: {mnemonic, address}}
   to e2e/.fixtures/accounts.json (gitignored — see .gitignore in §12.1).
6. Print "Alice 0x… (<seededBalance> sats)  Bob 0x… (0 sats)" to stdout so CI
   logs show exactly what each run used.
```

`e2e/_global-teardown.ts`:

```text
1. Read e2e/.fixtures/accounts.json.
2. If E2E_KEEP_ACCOUNTS is unset, unlink the file. Accounts on-chain stay
   (server has no delete endpoint) — that's fine, they're random and unfunded.
```

Why two accounts and not one: `07-send.spec.ts` requires a real on-chain send between two real wallets — Alice → Bob — to populate Bob's transaction list. Self-send is rejected by the server, so a single fixture isn't sufficient.

## 6. Helper API

All paths relative to `e2e/`.

### `_helpers/api.ts`

```ts
export const api = {
  info(): Promise<InfoResponse>;
  balance(addressHex: string): Promise<BalanceResponse>;
  mint(addressHex: string): Promise<SendResponse>; // server picks the amount
  // No send/commit helpers — send is exercised through the UI.
};
```

Uses Node's built-in `fetch` (Node ≥ 20). Targets `E2E_API_URL`. Mirrors the runtime API client in `src/lib/api/client.ts` so a server contract change surfaces here too.

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

| Locator                                          | What it hides                            | Source file (PR-2 adds the `data-testid` here) |
| ------------------------------------------------ | ---------------------------------------- | ---------------------------------------------- |
| `text=/[0-9a-f]{8}@zkcoins\.app/`                | Wallet address chip                      | Already a content match — no attribute change needed |
| `[data-testid="balance-value"]`                  | Numeric BTC / USD balance                | `src/components/screens/WalletScreen.tsx` — wrap the `<h1>` + BTC `<p>` |
| `[data-testid="tx-row-amount"]`                  | Transaction row amount                   | `src/components/screens/WalletScreen.tsx::TransactionsList` |
| `[data-testid="tx-row-time"]`                    | Transaction row timestamp                | same file                                       |
| `[data-testid="seed-grid"]`                      | The 12 mnemonic words                    | `src/components/onboarding/Onboarding.tsx::SeedFlow` — wrap the `grid-cols-3 gap-2 …` `<div>` |
| `[data-testid="qr-code"]`                        | The receive QR (depends on address)      | `src/app/receive/page.tsx` — wrap the `QRCodeSVG` parent `<div>` |
| `[data-testid="proof-id"]`                       | The "proof #N" line on the send success screen | `src/app/send/page.tsx`                  |

The data-testid attributes are added **incrementally**, by the PR that first needs each one — not all at once in PR-2. The `snap` helper in `_helpers/screenshot.ts` references the full list from PR-1; Playwright's `mask` ignores selectors with no matches, so unused entries are inert until the matching component lands. No `data-testid` proliferation beyond this set — anything else has to be stable without one.

Per-PR ownership:

| Attribute             | First needed by             | Added in PR |
| --------------------- | --------------------------- | ----------- |
| `seed-grid`           | §8.2 / §8.3                 | PR-3        |
| `balance-value`       | §8.6                        | PR-7        |
| `tx-row-amount`       | §8.7 (post-send list shot)  | PR-8        |
| `tx-row-time`         | §8.7                        | PR-8        |
| `proof-id`            | §8.7 `send-success`         | PR-8        |
| `qr-code`             | §8.8                        | PR-9        |

### File naming

`<spec-prefix>-<step-slug>.png` — e.g. `02-create-seed-seed-reveal-shown-chromium-linux.png` (Playwright appends `-chromium-linux` automatically). Slugs are kebab-case and stable; renaming a step renames its baseline (review must call this out).

### Viewport

Default desktop 1440 × 900. Mobile 375 × 812 is captured for these five steps only:

| Step                              | Spec                              |
| --------------------------------- | --------------------------------- |
| `welcome-mobile`                  | §8.1 `01-onboarding-welcome`      |
| `settings-mobile`                 | §8.5 `05-disconnect`              |
| `balance-funded-mobile`           | §8.6 `06-balance`                 |
| `confirm-dialog-mobile`           | §8.7 `07-send`                    |
| `receive-default-mobile`          | §8.8 `08-receive`                 |

Other screens are desktop-only — adding more mobile shots doesn't add regression value worth the maintenance cost. Tablet (768 × 1024) is captured exactly once in §8.1:welcome-tablet to lock in the `md:` breakpoint where the card frame appears.

## 8. Test inventory (the exhaustive step list)

This section is the result of a line-by-line audit of every MVP component (`src/components/onboarding/Onboarding.tsx`, `src/components/screens/WalletScreen.tsx`, `src/app/page.tsx`, `src/app/send/page.tsx`, `src/app/receive/page.tsx`, `src/app/settings/page.tsx`, `src/components/AppShell.tsx`, `src/components/BottomNav.tsx`, `src/components/FooterLinks.tsx`, `src/components/PwaPrompt.tsx`). **Every button, every visible visual state, every conditional render** that the MVP user can reach is enumerated below. Each row is one `test()` and one screenshot baseline (unless marked `(no shot)`).

### 8.0 DEV-bundle vs PRD-bundle — what we screenshot

The E2E suite runs against the **DEV-built frontend** (https://dev.zkcoins.app) because that's the only deployment where `/api/mint` (faucet) is available — without it we can't seed Alice every run. The DEV bundle has every `FEATURES.*` flag ON. That introduces two categories of difference from PRD:

**(a) Pure navigation detours — traversed silently, not screenshotted.**

Where DEV inserts an extra screen on the way to an MVP screen, the test clicks through it without taking a baseline. The screen is not MVP and locking its pixels would lock in a build-flag artefact.

| Detour                                                          | Test behaviour                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Welcome → CREATE WALLET → PasskeyFlow intro → OTHER LOGIN OPTIONS → SeedFlow` | Click `CREATE WALLET`, immediately click `OTHER LOGIN OPTIONS`. No shot.   |
| `SeedImportFlow → PasskeyRestore link`                          | Ignored — not clicked.                                                       |

**(b) Inline gated UI on MVP screens — accepted in baselines.**

On screens we DO screenshot, the DEV bundle renders extra widgets the PRD bundle dead-strips. Every wallet, settings, send, and receive screenshot includes some of these:

| DEV-only widget                                          | Gated by                     | Appears on                                       |
| -------------------------------------------------------- | ---------------------------- | ------------------------------------------------ |
| `Apps` tab in BottomNav                                  | `FEATURES.APPS_DIRECTORY`    | Every shot of WalletScreen / Settings (AppShell) |
| Username claim input + button on the wallet              | `FEATURES.USERNAMES`         | §8.6 `balance-funded-desktop/mobile`             |
| Faucet button on empty-balance banner                    | `FEATURES.FAUCET` + signet   | §8.6 `balance-zero-faucet-visible`               |
| `@user` / `$user` resolver hint placeholder on Send      | `FEATURES.USERNAMES`         | §8.7 `send-default`, `recipient-valid-username`  |
| `dev-*` hostnames in FooterLinks                          | runtime (`hostname.startsWith('dev')`) | §8.1, §8.5, §8.9 (any screen with FooterLinks) |
| "Buy private BTC through DFX" link in no-balance variant | `FEATURES.APPS_DIRECTORY`    | §8.7 `send-no-funds-banner`                      |

A future PRD smoke pass (out of scope here) is the only way to assert the PRD-stripped variants exist. These specs deliberately do **not** try to assert PRD behaviour.

**Implication**: a reviewer looking at a new baseline must mentally subtract the DEV-only widgets above and verify the rest. Each spec's top-of-file comment must list which DEV-only widgets the baselines below it include, so the reviewer doesn't have to guess.

### 8.1 `01-onboarding-welcome.spec.ts` (5 tests / 5 shots)

The landing entry plus both onward affordances. Onboarding has its own visual style (full-bleed hero on mobile, framed card on desktop, decorative pixel-grid background) that needs to lock in.

| #  | Step                          | Notes                                                                                    |
| -- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| 1  | welcome-desktop               | Default 1440 × 900. PixelLogo, "Welcome to zkCoins" + ghost icon, 3 Benefit cards, both buttons, footer label, FooterLinks row. |
| 2  | welcome-mobile                | 375 × 812. Same content stacked.                                                          |
| 3  | welcome-tablet                | 768 × 1024 — the mid-breakpoint where the card frame appears (`md:border md:bg-surface`). |
| 4  | welcome-create-hover          | Hover on "CREATE WALLET" — colour shift to `bg-bitcoin-hover`. (Trace `:hover` via `page.hover()`.) |
| 5  | welcome-restore-hover         | Hover on "Restore existing wallet" — text colour shifts to bitcoin orange.               |

### 8.2 `02-create-seed.spec.ts` (11 tests / 10 shots, 1 no-shot)

Drives `Welcome → CREATE WALLET → (PasskeyFlow intro — traversed, no shot) → OTHER LOGIN OPTIONS → SeedFlow` through every stage. Resets IDB+localStorage in `beforeEach`. The DEV passkey-intro screen is clicked through but **not** screenshotted — see §8.0 (a).

| #  | Step                          | Notes                                                                                                |
| -- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1  | seed-generating               | After clicking through to SeedFlow — `stage='generating'`, "Generating seed phrase…" text. Race the WASM with a small artificial slowdown (`page.route('**/zkcoins_wasm_bg.wasm', delay 800ms)`). |
| 2  | seed-reveal-hidden            | `stage='reveal'`, `revealed=false`. 12-word grid blurred + "Tap to reveal" overlay button.           |
| 3  | seed-reveal-shown             | `stage='reveal'`, `revealed=true`. Mnemonic grid revealed (masked), "Important" warning box, "I've written it down" button. |
| 4  | seed-acknowledged             | `stage='confirm'`. Word grid still revealed, warning box + I've-written-it-down gone, "Continue" button alone. |
| 5  | password-empty                | `stage='password'`. Both inputs empty, "Create wallet" button disabled.                              |
| 6  | password-filled               | Both inputs filled. Button enabled.                                                                  |
| 7  | password-too-short            | Confirm a < 8 char password — error "Password must be at least 8 characters", `stage` reverts.       |
| 8  | password-mismatch             | Mismatched confirms — error "Passwords do not match".                                                 |
| 9  | creating                      | After Create wallet — `stage='creating'`, button "Creating…" disabled. Capture before the wallet renders (`waitForResponse('**/api/balance**')` interceptor). |
| 10 | wallet-after-create           | Final state — `WalletScreen` rendered, AppShell wrapper, BottomNav visible, no-balance banner shown. |
| 11 | back-from-reveal (no shot)    | At `stage='reveal'`, click StepHeader Back → returns to Welcome. Asserts URL only.                   |

### 8.3 `03-restore-seed.spec.ts` (11 tests / 10 shots, 1 no-shot)

Drives `Welcome → Restore existing wallet → SeedImportFlow` through every stage. Reuses Alice's mnemonic from `_global-setup.ts`.

| #  | Step                          | Notes                                                                                          |
| -- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| 1  | restore-entry-empty           | `stage='input'`. Textarea empty, "Continue" disabled.                                          |
| 2  | restore-input-typed-valid     | Alice's mnemonic typed, Continue enabled.                                                       |
| 3  | restore-input-wrong-count     | 5 random words pasted — error "Enter exactly 12 words".                                        |
| 4  | restore-input-bad-bip39       | 12 words but not all in BIP-39 list — error "Invalid seed phrase — check your words and try again". |
| 5  | restore-password-empty        | After Continue — `stage='password'` with empty inputs.                                          |
| 6  | restore-password-filled       | Both inputs filled, "Restore wallet" enabled.                                                  |
| 7  | restore-password-too-short    | Confirm < 8 char password — error + stage stays.                                                |
| 8  | restore-password-mismatch     | Mismatched confirms — error.                                                                   |
| 9  | restoring                     | `stage='restoring'`, button "Restoring…" disabled.                                              |
| 10 | wallet-after-restore          | Final WalletScreen with Alice's address (masked) and her seeded balance.                       |
| 11 | back-from-input (no shot)     | StepHeader Back returns to Welcome.                                                             |

### 8.4 `04-unlock-password.spec.ts` (5 tests / 5 shots)

Cold-start the app with Alice's encrypted blob in IndexedDB and Alice's `authMethod='seed'` in localStorage so `Home` renders `UnlockScreen`.

| # | Step                           | Notes                                                                            |
| - | ------------------------------ | -------------------------------------------------------------------------------- |
| 1 | unlock-empty                   | Cold start. Logo + "Welcome back" + empty password input + disabled Unlock.      |
| 2 | unlock-typed                   | Password typed, Unlock enabled.                                                  |
| 3 | unlock-unlocking               | After click — button text "Unlocking…" + disabled.                               |
| 4 | unlock-wrong-error             | Wrong password attempted, error "Incorrect password" in red below button.        |
| 5 | unlock-success-wallet          | Correct password unlocks → WalletScreen rendered with Alice's wallet.            |

Closes the **MVP triage gap**.

### 8.5 `05-disconnect.spec.ts` (7 tests / 7 shots)

Settings page from Alice's wallet, all sections + every interactive widget the user can touch. The three Toggle widgets (Auto-lock, Auto-rotate, Tor routing) are all `disabled` and their `:hover` resolves to the same `cursor-not-allowed` style — a dedicated hover shot would be pixel-identical to `settings-desktop` and is omitted.

| # | Step                          | Notes                                                                                            |
| - | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| 1 | wallet-to-settings-nav        | WalletScreen with the Settings tab in BottomNav highlighted on click (use `page.hover()` first). |
| 2 | settings-desktop              | Full settings render on 1440 × 900. Header with badge, all 4 Sections expanded, Disconnect button. |
| 3 | settings-mobile               | Same on 375 × 812.                                                                               |
| 4 | settings-disconnect-hover     | Hover on the "Disconnect Wallet" button — border colour shifts to bitcoin/40.                    |
| 5 | disconnect-confirm-dialog     | Click Disconnect → `window.confirm` dialog. Capture via `page.on('dialog', d => screenshot then d.accept())`. The dialog is browser-chrome; this row asserts the dialog's `.message()` text and screenshots the empty page underneath. |
| 6 | post-disconnect-welcome       | After accepting — landed on `/`, Welcome screen visible (DEV bundle, so first time).             |
| 7 | disconnect-cancel-noop        | Repeat from a fresh state, but `dialog.dismiss()` — assert the wallet is **still** there.        |

### 8.6 `06-balance.spec.ts` (6 tests / 6 shots)

WalletScreen balance area + copy chip + faucet banner under Alice and Bob.

| # | Step                           | Notes                                                                                |
| - | ------------------------------ | ------------------------------------------------------------------------------------ |
| 1 | balance-funded-desktop         | Alice loaded. Balance $X + BTC value (masked), eye icon, address chip, Send/Receive enabled, no empty banner. |
| 2 | balance-funded-mobile          | Same, 375 × 812.                                                                     |
| 3 | balance-hidden                 | Eye toggle clicked → balance shows `••••`, EyeOff icon, BTC line also masked.        |
| 4 | balance-zero-faucet-visible    | Bob loaded. Empty-wallet banner with "Wallet is empty" + Faucet button (`FEATURES.FAUCET` on, DEV is signet). |
| 5 | balance-faucet-minting         | Faucet click — button shows "Minting…" disabled. Intercept `/api/mint` to delay 800 ms. |
| 6 | balance-copied-feedback        | Click address chip — Check icon + "copied" text appear for 1.5 s (assert via `waitForFunction` immediately after click). |

### 8.7 `07-send.spec.ts` (15 tests / 14 shots, 1 no-shot)

The full Send pipeline plus every error branch. Alice → Bob, 1 000 sats.

| #  | Step                            | Notes                                                                                  |
| -- | ------------------------------- | -------------------------------------------------------------------------------------- |
| 1  | send-default                    | `/send`, both inputs empty, "Send privately" disabled.                                 |
| 2  | send-no-funds-banner            | Same page reached as Bob — "No funds to send" banner visible.                          |
| 3  | recipient-valid-hex             | Bob's hex address pasted. Amount still empty → button disabled.                        |
| 4  | recipient-valid-username        | `bob@zkcoins.app` typed (DEV-bundle artefact, see §8.0).                               |
| 5  | amount-typed                    | Both fields valid, Send enabled.                                                       |
| 6  | amount-set-max-clicked          | Click "Set max" → input value flips to formatted balance.                              |
| 7  | amount-invalid-text             | Type `abc` → click Send → error "Invalid amount".                                       |
| 8  | amount-insufficient             | Amount > Alice's balance → click Send → error "Insufficient balance".                  |
| 9  | confirm-dialog-desktop          | After Send with valid inputs — confirm card visible with amount + recipient + Cancel + Confirm Send. |
| 10 | confirm-dialog-mobile           | Same on 375 × 812.                                                                     |
| 11 | confirm-cancel-back             | Click Cancel → returns to the form with inputs preserved.                              |
| 12 | sending-creating-proof          | Click Confirm Send → button "Creating proof…" disabled. Intercept `/api/send` with 1 s delay. |
| 13 | send-success                    | Server confirms — success screen with Check icon, "Sent privately", amount, proof #N, Done. |
| 14 | send-failure-network            | `route('**/api/send', r => r.abort())` → error message below button.                   |
| 15 | recovering-banner (no shot)     | Seed an unfinished inflight commit in localStorage, reload, assert the orange "Recovering a previous in-flight transaction…" banner exists. (No shot — too transient under happy-path conditions.) |

### 8.8 `08-receive.spec.ts` (4 tests / 4 shots)

`/receive` plus the copy affordance.

| # | Step                           | Notes                                                                            |
| - | ------------------------------ | -------------------------------------------------------------------------------- |
| 1 | receive-default-desktop        | QR + address card + Copy button + Tip card.                                      |
| 2 | receive-default-mobile         | Same on 375 × 812.                                                               |
| 3 | receive-after-copy             | Click Copy address → button text flips to "Copied" with Check icon.              |
| 4 | receive-back-to-wallet         | Click Back → WalletScreen renders again.                                          |

### 8.9 `09-network-and-shell.spec.ts` (6 tests / 6 shots)

AppShell + BottomNav + Network info badge. Covers the MVP "Network info badge" function plus the navigation chrome (`AppShell`, `BottomNav`, `FooterLinks`) that wraps every other screen — those aren't MVP functions on their own but every other spec inherits their pixels and would diff on chrome changes if we didn't lock them once here.

| # | Step                           | Notes                                                                                                  |
| - | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1 | shell-bottomnav-wallet-active  | WalletScreen rendered, Wallet tab orange, Apps + Settings inactive.                                    |
| 2 | shell-bottomnav-settings-active | Navigate to Settings — Settings tab orange.                                                            |
| 3 | shell-footerlinks-row          | Default row variant on Wallet screen — 7 entries dot-separated with dev-* hosts.                       |
| 4 | shell-footerlinks-grid         | Grid variant on Settings — same entries as 2-col cards with → and ↗ arrows.                            |
| 5 | network-badge-signet           | Settings header right side — signet badge text + dot indicator. Subset shot of the badge area only.    |
| 6 | network-badge-loading          | Intercept `/api/info` with 1 s delay, screenshot Settings header before the badge appears.             |

### 8.10 `10-pwa.spec.ts` (4 tests / 4 shots)

PwaPrompt has 3 detection modes plus the install-in-progress branch.

| # | Step                            | Notes                                                                                                                       |
| - | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1 | pwa-native-mode                 | Mock UA = Chrome on Android-like desktop, dispatch synthetic `beforeinstallprompt` → "Install" button visible.              |
| 2 | pwa-native-installing           | Click Install → mock `prompt()` to delay 1 s, button "Installing…" disabled.                                                |
| 3 | pwa-ios-mode                    | Mock UA = Safari iOS → share-icon instructions card visible.                                                                |
| 4 | pwa-manual-mode                 | Default desktop UA without BIP event → manual address-bar hint card visible.                                                |

Dismissed and already-installed branches collapse the component to `null`; we test their **absence** in `06-balance.spec.ts:balance-funded-desktop` (Alice's screenshot has no PwaPrompt because `dismissed` is wired by the global setup).

Closes the **MVP triage gap** noted in `README.md` for "Install as PWA".

### 8.11 `11-cross-spec-redirects.spec.ts` (3 tests / 3 shots)

Hard-to-locate routes the user can reach but the rest of the inventory doesn't normally visit.

| # | Step                           | Notes                                                                       |
| - | ------------------------------ | --------------------------------------------------------------------------- |
| 1 | send-no-account-redirect       | Visit `/send` with no account in store — Wallet icon + "Redirecting to wallet…". |
| 2 | receive-no-account-redirect    | Same for `/receive`.                                                         |
| 3 | settings-no-account-redirect   | Same for `/settings`.                                                        |

### 8.12 Existing `visual.spec.ts` retirement

After §8.1 lands (`01-onboarding-welcome.spec.ts`), the new spec captures `welcome-desktop/mobile/tablet`, `02-create-seed:seed-reveal-hidden + seed-reveal-shown` covers the `seed-setup-generate + seed-mnemonic-display` baselines, and `03-restore-seed:restore-entry-empty` covers `seed-import`. **Delete** `e2e/visual.spec.ts` and `e2e/visual.spec.ts-snapshots/` in the PR that introduces `02-create-seed.spec.ts` (PR-3 in §11.3 below).

### 8.13 Totals

| Spec file                                  | Tests | Screenshots (linux only) |
| ------------------------------------------ | ----- | ------------------------ |
| `01-onboarding-welcome.spec.ts`            | 5     | 5                        |
| `02-create-seed.spec.ts`                   | 11    | 10                       |
| `03-restore-seed.spec.ts`                  | 11    | 10                       |
| `04-unlock-password.spec.ts`               | 5     | 5                        |
| `05-disconnect.spec.ts`                    | 7     | 7                        |
| `06-balance.spec.ts`                       | 6     | 6                        |
| `07-send.spec.ts`                          | 15    | 14                       |
| `08-receive.spec.ts`                       | 4     | 4                        |
| `09-network-and-shell.spec.ts`             | 6     | 6                        |
| `10-pwa.spec.ts`                           | 4     | 4                        |
| `11-cross-spec-redirects.spec.ts`          | 3     | 3                        |
| **Σ**                                      | **77**| **74**                   |

74 linux baselines, 77 tests. Each baseline is justified by an enumerable interaction or render-conditional in the source — there is no padding, pure DEV-bundle navigation detours are traversed without a shot (§8.0 (a)), and visual-twin states (e.g. disabled toggles that don't change on hover) are folded into the canonical shot rather than duplicated.

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
      E2E_FAUCET_CALLS: '1'
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

### 9.4 Debugging a failing visual diff

When `e2e-visual` reports a pixel diff, the failed run uploads a `playwright-report/` artefact (HTML report + per-test `actual.png`, `expected.png`, `diff.png`). The flow:

1. Open the failed CI run → download the `playwright-report` artefact.
2. `npx playwright show-report ./playwright-report` opens the HTML viewer locally — click the failed test → tab "Image diff".
3. Decide: regression (revert the offending UI change) or intended (regenerate the baseline via §9.2 workflow).
4. Never edit a baseline PNG by hand. Always go through `regenerate-visual-baselines.yml`.

Local iteration without CI: `E2E_BASE_URL=https://dev.zkcoins.app npx playwright test --headed` runs a single chromium window — useful for stepping through a flaky selector. Pair with `--debug` for the Playwright Inspector.

## 10. Triage gaps and explicit non-coverage

- **PWA install**: §8.10 covers the deferred-prompt save path. The native browser prompt cannot be exercised headless. We accept this gap and document it here.
- **Account creation crypto**: tested in unit tests (`src/__tests__/lib/crypto/*`) at 100%. Not re-tested at the E2E layer for individual byte values — E2E only proves "wallet exists and is functional after Create".
- **Faucet flow** (`Mint test BTC` button): non-MVP, gated, but exists in the DEV build. We **do not** add a screenshot spec for it — it's exercised indirectly by the `globalSetup` faucet call, which fails the whole suite if `/api/mint` regresses.
- **Network-activity chart**: triage `keep`, non-MVP. Covered in `visual.spec.ts` today; the new specs drop it (no longer in the MVP file list).

## 11. Workflow for developers (and future Claude sessions)

### 11.1 Adding a new MVP feature

1. Add the feature to `README.md § Features` (mvp row).
2. Add a step to the relevant spec or a new spec file in this plan (update §8 and the totals in §8.13).
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
2. **PR-2**: §8.1 `01-onboarding-welcome.spec.ts`. The address-chip mask is a regex match (no attribute needed). Does **not** retire `visual.spec.ts` yet — its `landing-*` shots still serve as a sanity diff while the new suite ramps.
3. **PR-3**: §8.2 `02-create-seed.spec.ts`. Adds `data-testid="seed-grid"` to `Onboarding.tsx::SeedFlow`. Retires `visual.spec.ts` and its snapshots dir in the same PR (the new file is a superset).
4. **PR-4**: §8.3 `03-restore-seed.spec.ts`. Wires up `fixtures.aliceLogin`.
5. **PR-5**: §8.4 `04-unlock-password.spec.ts` *(closes MVP triage gap)*.
6. **PR-6**: §8.5 `05-disconnect.spec.ts`.
7. **PR-7**: §8.6 `06-balance.spec.ts`. Adds `data-testid="balance-value"` to `WalletScreen.tsx`.
8. **PR-8**: §8.7 `07-send.spec.ts` (this is the big one — Alice → Bob real on-chain send). Adds `data-testid="tx-row-amount"` + `"tx-row-time"` to `WalletScreen.tsx::TransactionsList` and `"proof-id"` to `send/page.tsx`.
9. **PR-9**: §8.8 `08-receive.spec.ts`. Adds `data-testid="qr-code"` to `receive/page.tsx`.
10. **PR-10**: §8.9 `09-network-and-shell.spec.ts`.
11. **PR-11**: §8.10 `10-pwa.spec.ts` *(closes MVP triage gap)*.
12. **PR-12**: §8.11 `11-cross-spec-redirects.spec.ts`.
13. **PR-13**: §9 CI integration — `e2e-visual` job + `regenerate-visual-baselines.yml`. Last so the gate only flips on a fully passing suite.

**Transactions coverage** (the original "06 transactions" spec) lives inside `07-send.spec.ts`: every send produces a tx row, and the spec asserts both Alice's outbound row and Bob's inbound row at the end. The transaction icon variants (send/receive/mint) are exercised in `06-balance.spec.ts:balance-zero-faucet-visible` followed by the faucet-mint in `balance-faucet-minting`. No dedicated spec.

Each PR:

- Adds **only the spec it's labelled with** plus any unblocking helper change.
- Runs `regenerate-visual-baselines.yml` once to commit the linux baselines.
- Updates §8.13 totals in this file when the spec lands.
- Is reviewed for the screenshot diff in the auto-commit by a human (or, for autonomous Claude work, by the next reviewer).

If a PR can't reach green inside 25 minutes of CI: don't merge, downgrade to focused work; do **not** raise the timeout.

## 12. File layout (final state after all 13 PRs)

```
e2e/
├── README.md                              # this document
├── _global-setup.ts                       # §5
├── _global-teardown.ts                    # §5
├── _helpers/
│   ├── api.ts                             # §6.1
│   ├── fixtures.ts                        # §6.4
│   ├── screenshot.ts                      # §6.3
│   └── wallet.ts                          # §6.2
├── .fixtures/                             # gitignored — written by global setup
│   └── accounts.json
├── 01-onboarding-welcome.spec.ts          # §8.1
├── 01-onboarding-welcome.spec.ts-snapshots/  # linux PNGs
├── 02-create-seed.spec.ts                 # §8.2
├── 02-create-seed.spec.ts-snapshots/
├── 03-restore-seed.spec.ts                # §8.3
├── 03-restore-seed.spec.ts-snapshots/
├── 04-unlock-password.spec.ts             # §8.4
├── 04-unlock-password.spec.ts-snapshots/
├── 05-disconnect.spec.ts                  # §8.5
├── 05-disconnect.spec.ts-snapshots/
├── 06-balance.spec.ts                     # §8.6
├── 06-balance.spec.ts-snapshots/
├── 07-send.spec.ts                        # §8.7
├── 07-send.spec.ts-snapshots/
├── 08-receive.spec.ts                     # §8.8
├── 08-receive.spec.ts-snapshots/
├── 09-network-and-shell.spec.ts           # §8.9
├── 09-network-and-shell.spec.ts-snapshots/
├── 10-pwa.spec.ts                         # §8.10
├── 10-pwa.spec.ts-snapshots/
├── 11-cross-spec-redirects.spec.ts        # §8.11
├── 11-cross-spec-redirects.spec.ts-snapshots/
└── webauthn.spec.ts                       # unchanged — non-MVP DEV-bundle passkey coverage
```

### 12.1 `.gitignore` addition

```
e2e/.fixtures/
```

## 13. Open questions to flag in PR-1

Things that the plan **does not** yet pin down — surface them in PR-1's description so the reviewer can make a call:

- **Confirm dialog** for Disconnect: today it's `window.confirm`. If the redesign replaces it with an in-app modal, the `04-disconnect.spec.ts` `disconnect-confirm` screenshot has to switch from `page.on('dialog')` to a real DOM screenshot. Track in PR-5.
- **Mobile baselines for restore/unlock**: §7 doesn't list them. If a redesign breaks the small-viewport login flow, this plan won't catch it. Reviewer can opt to add them — that's +3 baselines.
- **Toast component**: every "copied" toast in the app currently uses the same pattern. If §8.6:balance-copied-feedback **or** §8.8:receive-after-copy catches a regression, look at the shared logic in `WalletScreen.tsx` and `app/receive/page.tsx`, not the spec.
- **Faucet button is non-MVP** but the empty-balance flow makes it the most ergonomic way to test the empty-state. §8.6:balance-zero-faucet-visible captures the DEV-bundle banner. The PRD-bundle variant of this same screen (no Faucet button) is **not** covered here — add a PRD smoke spec later.
- **`set max` button** in `07-send` mutates the amount input. If the formatting changes (e.g., trailing zeros) the screenshot will catch it.
