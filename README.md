# zkCoins App

Web application for [zkcoins.app](https://zkcoins.app) — private Bitcoin transactions via Shielded CSV. Installable as PWA.

## Live

| Environment | URL                                              | Image               |
| ----------- | ------------------------------------------------ | ------------------- |
| **PRD**     | [zkcoins.app](https://zkcoins.app)               | `zkcoin/app:latest` |
| **DEV**     | [dev.zkcoins.app](https://dev.zkcoins.app)       | `zkcoin/app:beta`   |
| **Status**  | [status.zkcoins.app](https://status.zkcoins.app) | —                   |

## Stack

| Layer     | Technology                | Why                                                         |
| --------- | ------------------------- | ----------------------------------------------------------- |
| Framework | Next.js 15 (App Router)   | SSR, standalone Docker output, largest React ecosystem      |
| Language  | TypeScript (strict)       | Type safety                                                 |
| Styling   | Tailwind CSS              | Dark theme (#0a0a0a), Bitcoin orange (#f7931a)              |
| State     | Zustand                   | Minimal boilerplate, encrypted IndexedDB persistence        |
| Crypto    | Rust → WASM               | secp256k1 + BIP32 from bitcoin crate (same as Bitcoin Core) |
| PWA       | Service Worker + Manifest | Installable, offline-capable, standalone mode               |

Full rationale: [docs.zkcoins.app/tech-decisions](https://docs.zkcoins.app/tech-decisions)

## Contributing

**New PRs may only merge into `develop` if test coverage is 100% on the activated surface.** Code behind an `NEXT_PUBLIC_ENABLE_*` build-time flag or a server-side capability gate (`useFeatures().FAUCET`, `useFeatures().USERNAMES`) is excluded — feature-gated code does not need to be tested as long as the gate stays off in the PRD build. Concretely:

- `npm run test:coverage` must report `100% lines · 100% statements · 100% functions · 100% branches`. CI enforces this via the `thresholds` block in `vitest.config.ts`.
- Defensive code that genuinely cannot be reached in happy-dom (SSR guards, IDB `onerror` callbacks, the 2-minute request timeout) is exempted by an inline `/* c8 ignore */` annotation with a one-line reason.
- The branch is protected on GitHub: a PR cannot be merged while CI is red.

The same rule applies to `zk-coins/server` (gated Cargo features are excluded from the measured scope).

## Features

User-facing functions, their activation status, and the tests that cover them.

**Status legend** (current behaviour): `always` = hard-coded on · `env` = build-time flag, dead-code-eliminated when off · `server` = runtime gate driven by `/api/info.capabilities`, hidden when off · `settings` = togglable via in-app Settings.

**Triage legend** (MVP testing decision): `mvp` = in MVP scope, must reach full test coverage before launch · `gate` = not in MVP scope; hidden behind a build-time flag, default off, no test coverage required · `keep` = current gating already adequate, no migration needed.

**Coverage legend:** unit % refers to Vitest line coverage of the lowest-covered involved file in `src/lib/**` + `src/stores/**` (Components are excluded from coverage scope). `e2e` means a Playwright spec covers the flow. `—` means no test exists.

| Feature                        | Status                                       | Triage | Tests                 |
| ------------------------------ | -------------------------------------------- | ------ | --------------------- |
| Create wallet — seed phrase    | always                                       | mvp    | 100% · e2e            |
| Create wallet — passkey        | env (`NEXT_PUBLIC_ENABLE_PASSKEY`)           | gate   | 14% · e2e             |
| Restore wallet — seed phrase   | always                                       | mvp    | 100% · e2e            |
| Restore wallet — passkey       | env (`NEXT_PUBLIC_ENABLE_PASSKEY`)           | gate   | 14% · e2e             |
| Unlock wallet — password       | always                                       | mvp    | 100% · e2e            |
| Unlock wallet — passkey        | env (`NEXT_PUBLIC_ENABLE_PASSKEY`)           | gate   | 14% · e2e             |
| Disconnect wallet              | always                                       | mvp    | 100% · e2e            |
| View balance                   | always                                       | mvp    | 100% · e2e            |
| View transaction history       | always                                       | mvp    | 100% · e2e            |
| Send Bitcoin (2-phase)         | always                                       | mvp    | 100% · e2e            |
| Receive Bitcoin (address + QR) | always                                       | mvp    | 100% · e2e            |
| Mint test BTC (faucet)         | server (`capabilities.faucet`)¹              | gate   | 100% · e2e (indirect) |
| Claim username                 | server (`capabilities.usernames`)            | gate   | 100% · e2e (visual)   |
| Resolve username (in Send)     | server (`capabilities.usernames`)            | gate   | 100% · e2e (visual)   |
| Network info badge             | always                                       | mvp    | 100% · e2e            |
| Network activity chart         | env (`NEXT_PUBLIC_EXPLORER_URL`)²            | keep   | 0% · —                |
| Install as PWA                 | always                                       | mvp    | — · e2e               |
| Apps directory                 | env (`NEXT_PUBLIC_ENABLE_APPS_DIRECTORY`)    | gate   | e2e (visual only)     |
| Auto-lock (stub)               | env (`NEXT_PUBLIC_ENABLE_AUTO_LOCK`)³        | gate   | —                     |
| Auto-rotate receive (stub)     | env (`NEXT_PUBLIC_ENABLE_ADDRESS_ROTATION`)³ | gate   | —                     |
| Tor routing (stub)             | env (`NEXT_PUBLIC_ENABLE_TOR_ROUTING`)³      | gate   | —                     |
| `/reset` — wipe local state    | env (`NEXT_PUBLIC_ENABLE_DEV_ROUTES`)        | gate   | —                     |
| `/simulate` — demo populate    | env (`NEXT_PUBLIC_ENABLE_DEV_ROUTES`)        | gate   | —                     |

¹ Faucet additionally checks `/api/info.network` at runtime and stays hidden if the connected server reports `network = mainnet`, even if the `capabilities.faucet` gate is on. Defence in depth.
² Empty (default) → `/network` shows simulated data with a "Preview · simulated" badge. URL set → live chart fetched from the explorer.
³ UI stub only: the toggle renders `disabled` with a `Planned` badge and has no runtime effect. The flag exists so a local developer can inspect the UI sketch via `.env.local`. Activating these features is **not done by setting the flag in DEV or PRD** — when the feature is implemented, the gate is removed from the code rather than the env var being set on the deploy.

### Feature gates — two flavours

Two independent gating mechanisms coexist:

1. **Build-time client flags** (`NEXT_PUBLIC_ENABLE_*`, inlined by Next.js). Local-dev only — a developer can opt a gated UI in by setting the variable in `.env.local`. Not wired up in `deploy-dev.yaml` or `deploy-prd.yaml`, and the `Dockerfile` declares no matching `ARG`. DEV mirrors PRD; both bundles contain only the ungated code. When a feature is ready to ship, the gate is removed from the source, **not** flipped on for a deploy. Read via `FEATURES.X` (or `useFeatures().X` inside components).

2. **Server-side capability gates** (`useFeatures().FAUCET`, `useFeatures().USERNAMES`). Reported by the server at `GET /api/info.capabilities`, mirroring the server's Cargo feature set. The capabilities store fail-closes on a missing response, so a pre-#29 server or an unreachable server hides the gated UI rather than crashing. The same shipped bundle works against any server because the gate is checked at runtime — see [`zk-coins/server` issue #29](https://github.com/zk-coins/server/issues/29) and [`zk-coins/app` issue #97](https://github.com/zk-coins/app/issues/97).

| `.env.local` var (`NEXT_PUBLIC_*`) | Gates                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `ENABLE_PASSKEY`                   | The three passkey flows (create / restore / unlock)                     |
| `ENABLE_APPS_DIRECTORY`            | `/apps` route, the Apps tab in the bottom nav, DFX link on empty Wallet |
| `ENABLE_AUTO_LOCK`                 | Settings → Security "Auto-lock" toggle (stub³)                          |
| `ENABLE_ADDRESS_ROTATION`          | Settings → Privacy "Auto-rotate receive address" toggle (stub³)         |
| `ENABLE_TOR_ROUTING`               | Settings → Privacy "Tor routing" toggle (stub³)                         |
| `ENABLE_DEV_ROUTES`                | `/reset` and `/simulate` pages                                          |

The two API URL placeholders (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_EXPLORER_URL`) follow a different, runtime-injection pattern via `entrypoint.sh`, unchanged.

### Triage gaps

_Closed (2026-05-16):_ all 10 `mvp` features now have at least one
dedicated E2E spec and the unit-coverage figure is 100 % across the
MVP-scoped files. Two historical gaps were:

- **Unlock wallet — password** — now covered by `e2e/04-unlock-password.spec.ts` (5 tests).
- **Install as PWA** — `e2e/10-pwa.spec.ts` (4 tests) covers the deferred-prompt save path in native / iOS-Safari / manual-fallback modes plus the "Installing…" sub-state. The browser-native install dialog itself stays out of scope because it cannot be exercised headless — that's documented as an accepted gap in `e2e/README.md § 10`.

### Details

#### Create wallet — seed phrase

- **UI:** `src/components/onboarding/Onboarding.tsx` (`SeedFlow`) reached from `src/app/page.tsx`
- **Crypto:** `@zkcoins/wasm` (`generateMnemonic`, `createAccountFromMnemonic`), `src/lib/crypto/encryption.ts`, `src/lib/crypto/key-derivation.ts`
- **Storage:** `src/lib/crypto/storage.ts` (encrypted IndexedDB blob), `src/stores/wallet.ts::saveWithPassword`
- **APIs:** `GET /api/balance` (optional initial balance fetch)
- **Tests:** unit `src/__tests__/lib/crypto/encryption.test.ts`, `key-derivation.test.ts`, `storage.test.ts`, `stores/wallet.test.ts` — e2e `e2e/01-onboarding-welcome.spec.ts` (entry path) + `e2e/02-create-seed.spec.ts` (10 tests covering reveal → confirm → password → wallet)

#### Create wallet — passkey

- **UI:** `Onboarding.tsx` (`PasskeyFlow`)
- **Crypto:** `src/lib/crypto/passkey.ts` (WebAuthn + PRF), HKDF mnemonic derivation via `key-derivation.ts`, `encryption.ts`
- **Storage:** Encrypted IndexedDB via `storage.ts`, credential metadata via `saveCredential`
- **APIs:** `GET /api/balance` (optional)
- **Tests:** unit `src/__tests__/lib/crypto/passkey.test.ts` (low % reflects WebAuthn surface that can't run in happy-dom — most paths are covered in e2e with `@simplewebauthn/testing`) — e2e `e2e/webauthn.spec.ts`

#### Restore wallet — seed phrase

- **UI:** `Onboarding.tsx` (`SeedImportFlow`)
- **Crypto:** `validateMnemonic`, `createAccountFromMnemonic` (WASM), `encryption.ts`
- **Storage:** `storage.ts::saveEncryptedWallet`
- **APIs:** `GET /api/balance`
- **Tests:** unit (same as create) — e2e `e2e/03-restore-seed.spec.ts` (10 tests: textarea → continue → password → unlocked wallet)

#### Restore wallet — passkey

- **UI:** `Onboarding.tsx` (`PasskeyRestoreFlow`)
- **Crypto:** `authenticatePasskey`, `deriveMnemonicFromPrf`, `createAccountFromMnemonic`
- **Storage:** `saveCredential`, `saveWithPrf`
- **APIs:** `GET /api/balance`
- **Tests:** unit `passkey.test.ts`, `key-derivation.test.ts` — e2e `e2e/webauthn.spec.ts`

#### Unlock wallet — password

- **UI:** `src/app/page.tsx` (UnlockScreen)
- **Crypto:** `unlockWithPassword`, AES-256-GCM decrypt via `encryption.ts`
- **Storage:** `loadEncryptedWallet`
- **Tests:** unit `encryption.test.ts`, `storage.test.ts` — e2e `e2e/04-unlock-password.spec.ts` (5 tests covering empty form, wrong password, correct password)

#### Unlock wallet — passkey

- **UI:** UnlockScreen
- **Crypto:** `authenticatePasskey`, `unlockWithPrf`
- **Tests:** unit `passkey.test.ts` — e2e `e2e/webauthn.spec.ts`

#### Disconnect wallet

- **UI:** `src/app/settings/page.tsx` (Disconnect button + `window.confirm`)
- **Implementation:** `deleteWallet`, `deleteCredential`, `useAuthStore.reset()`
- **Tests:** unit `stores/wallet.test.ts`, `stores/auth.test.ts` — e2e `e2e/05-disconnect.spec.ts` (7 tests: settings → confirm dialog → onboarding)

#### View balance

- **UI:** `src/components/screens/WalletScreen.tsx` (balance card with 5 s polling, eye toggle to hide/show)
- **Implementation:** `api.balance()`, `format.ts::formatBtc/formatUsd`, `useWalletStore.setBalance`
- **APIs:** `GET /api/balance?address=<hex>`
- **Tests:** unit `client.test.ts`, `format.test.ts`, `format-full.test.ts`, `wallet.test.ts` — e2e `e2e/06-balance.spec.ts` (6 tests: zero-balance, faucet-visible, faucet-minting, funded desktop/mobile, balance-hidden)

#### View transaction history

- **UI:** `WalletScreen.tsx` (TransactionsList, icons per type, BTC compact format)
- **Implementation:** `useWalletStore.transactions` persisted under `zkcoins_transactions` in localStorage
- **Tests:** unit `wallet-transactions.test.ts` — e2e `e2e/07-send.spec.ts` (asserts Alice's outbound + Bob's inbound rows after a real send)

#### Send Bitcoin (2-phase)

- **UI:** `src/app/send/page.tsx` (recipient, amount, confirm dialog)
- **Implementation:** `signSendRequest` (Schnorr) → `api.sendSigned` → client commitment (`Schnorr(hash(account_state_hash || output_coins_root))`) → `api.commit`. In-flight commit recovery via `zkcoins_inflight_commit` in localStorage (3 attempts, exp. backoff)
- **APIs:** `POST /api/send`, `POST /api/commit`, `GET /api/username/resolve/:name` (if recipient starts with `@` or `$`)
- **Tests:** unit `client-signing.test.ts`, `client-username.test.ts`, `wallet-transactions.test.ts` — e2e `e2e/07-send.spec.ts` (13 tests covering recipient validation, amount validation, confirm dialog, real Alice→Bob send, post-send transaction rows)

#### Receive Bitcoin (address + QR)

- **UI:** `src/app/receive/page.tsx` (`toZkAddress`, QRCodeSVG, copy-to-clipboard)
- **Implementation:** `format.ts::toZkAddress`
- **Tests:** unit `format.test.ts` — e2e `e2e/08-receive.spec.ts` (4 tests: desktop, mobile, after-copy, back-to-wallet)

#### Mint test BTC (faucet)

- **UI:** `WalletScreen.tsx` empty-state banner with "Get test sats" button
- **Visibility:** Auto-hidden when `useNetworkStore.networkName === 'mainnet'`. No flag — runtime check against `/api/info`
- **Implementation:** `api.mint()`
- **APIs:** `POST /api/mint`, `GET /api/info` (network detection)
- **Tests:** unit `client.test.ts`, `network.test.ts` — e2e `e2e/06-balance.spec.ts` (`balance-zero-faucet-visible` asserts the button is rendered on signet) + indirect via `e2e/_global-setup.ts` which calls `/api/mint` to seed Alice + Bob every run

#### Claim username

- **UI:** `WalletScreen.tsx` (claim button + input)
- **Implementation:** `signClaimRequest` (Schnorr with pubkey_0) → `api.claimUsername`
- **APIs:** `POST /api/username/claim`
- **Tests:** unit `client-username.test.ts` — e2e `e2e/06-balance.spec.ts:balance-funded-desktop/mobile` (visually verifies the claim input + button render on a funded wallet)

#### Resolve username (in Send)

- **UI:** Send page input — recipient starting with `@` or `$` triggers resolution before signing
- **Implementation:** `api.resolveUsername`
- **APIs:** `GET /api/username/resolve/:username`
- **Tests:** unit `client-username.test.ts` — e2e `e2e/07-send.spec.ts:send-default + recipient-valid-username` (visually verifies the `@user` / `$user` placeholder hint)

#### Network info badge

- **UI:** `WalletScreen.tsx` + `src/app/settings/page.tsx`
- **Implementation:** `useNetworkStore` hydrated from `/api/info` on mount
- **APIs:** `GET /api/info`
- **Tests:** unit `stores/network.test.ts` — e2e `e2e/09-network-and-shell.spec.ts` (6 tests: signet badge, loading state, AppShell bottom-nav + footer-links variants)

#### Network activity chart

- **UI:** `src/app/network/page.tsx` (`NetworkActivity` component, 6 h window, 8 s polling)
- **Activation:** `NEXT_PUBLIC_EXPLORER_URL` empty → simulated data with `Preview · simulated` badge; URL set → live data fetched from explorer's `/network/activity?window_ms=…`
- **Implementation:** `src/lib/api/explorer.ts` + `src/lib/simulate-network.ts`
- **Tests:** unit — none for explorer fetcher (depends on external service); simulator also uncovered. No dedicated E2E — triage `keep` per `e2e/README.md § 10`

#### Install as PWA

- **UI:** `src/components/PwaPrompt.tsx` (handles `beforeinstallprompt`), manifest + service worker in `public/`
- **Tests:** e2e `e2e/10-pwa.spec.ts` (4 tests: native deferred prompt, native-installing sub-state, iOS-Safari instructions, manual desktop fallback). The browser-native install dialog itself is not exercised — that's an accepted gap per `e2e/README.md § 10`.

#### Apps directory

- **UI:** `src/app/apps/page.tsx` (static list with external links: DFX, OpenCryptoPay)
- **Tests:** indirectly via the BottomNav `Apps` tab visible in every WalletScreen/Settings baseline; no dedicated functional spec for the link destinations (triage `gate`)

#### Dev/demo routes

Reachable by direct URL, not in the nav. Not intended for end users.

- **`/reset`** — `src/app/reset/page.tsx` calls `deleteWallet`, `deleteCredential`, `resetAuth` on mount, then redirects home
- **`/simulate`** — `src/app/simulate/page.tsx` creates an account and fills `populateDemoHistory` (8 sample transactions) for screenshot/demo use

### Configuration

| Variable                              | When read                 | Default                   | Effect                                                                     |
| ------------------------------------- | ------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`                 | container start           | `https://api.zkcoins.app` | Backend API base URL. Substituted at startup by `entrypoint.sh`            |
| `NEXT_PUBLIC_EXPLORER_URL`            | container start           | _(empty)_                 | Live network activity source. Empty → `/network` shows simulated data      |
| `NEXT_PUBLIC_ENABLE_PASSKEY`          | local `npm run dev` build | `false`                   | Local-dev only: previews the three passkey flows                           |
| `NEXT_PUBLIC_ENABLE_APPS_DIRECTORY`   | local `npm run dev` build | `false`                   | Local-dev only: previews `/apps` and the Apps tab in nav                   |
| `NEXT_PUBLIC_ENABLE_AUTO_LOCK`        | local `npm run dev` build | `false`                   | Local-dev only: previews the Auto-lock stub toggle (Settings → Security)   |
| `NEXT_PUBLIC_ENABLE_ADDRESS_ROTATION` | local `npm run dev` build | `false`                   | Local-dev only: previews the Auto-rotate receive stub (Settings → Privacy) |
| `NEXT_PUBLIC_ENABLE_TOR_ROUTING`      | local `npm run dev` build | `false`                   | Local-dev only: previews the Tor routing stub (Settings → Privacy)         |
| `NEXT_PUBLIC_ENABLE_DEV_ROUTES`       | local `npm run dev` build | `false`                   | Local-dev only: previews `/reset` and `/simulate`                          |
| `E2E_BASE_URL`                        | playwright invoke         | `https://dev.zkcoins.app` | Playwright target URL — test-time only, not consumed by the running app    |

The Mint button and the username UI used to live behind `NEXT_PUBLIC_ENABLE_FAUCET` / `NEXT_PUBLIC_ENABLE_USERNAMES`. They are now driven at runtime by `GET /api/info.capabilities` (see issue #97), so the same shipped bundle automatically matches whatever Cargo features the connected server was built with.

Container vs. local: the two `_URL` placeholders are baked at build with a sentinel value (`NEXT_PUBLIC_API_URL_PLACEHOLDER`) and replaced at container start, so the same image can point at any backend. The `_ENABLE_*` flags are **not declared in the `Dockerfile`** and are never set in `deploy-{dev,prd}.yaml` — both shipped images contain only the ungated code. A developer can put any of these flags in `.env.local` to preview a gated UI under `npm run dev`. Shipping a gated feature means dropping its gate from the source.

### Tests

| Stack       | Command                 | What it covers                                                                                                                                                                                                                                 |
| ----------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest + v8 | `npm run test`          | 144 unit tests across `src/lib/**` and `src/stores/**`                                                                                                                                                                                         |
| Coverage    | `npm run test:coverage` | v8 coverage, scoped to the MVP activated surface. Latest run: **100% lines · 100% statements · 100% functions · 100% branches**. CI fails on any drop.                                                                                         |
| Playwright  | `npm run test:e2e`      | 12 active specs — 11 exhaustive (`e2e/0[1-9]-*.spec.ts` + `e2e/1[01]-*.spec.ts`, 73 tests / 70 linux visual baselines) + `webauthn.spec.ts` (DEV-bundle passkey coverage). Runs against `E2E_BASE_URL`. Full inventory in `e2e/README.md § 8`. |
| Playwright  | `npm run test:visual`   | Visual regression subset (baselines under `e2e/*.spec.ts-snapshots/`). Linux-only; regenerated via `.github/workflows/regenerate-visual-baselines.yml`.                                                                                        |

The coverage scope excludes `src/components/**`, `src/app/**`, and four files that belong to gated features (`crypto/passkey.ts`, `simulate.ts`, `simulate-network.ts`, `api/explorer.ts`) — see `vitest.config.ts`. Those files still have unit tests that run unconditionally; they are simply not counted toward the MVP coverage figure because the PRD build never reaches them.

Per-file unit coverage of the MVP activated surface (latest run):

| File                               | Line % |
| ---------------------------------- | ------ |
| `src/lib/features.ts`              | 100%   |
| `src/lib/format.ts`                | 100%   |
| `src/lib/api/client.ts`            | 100%   |
| `src/lib/crypto/encryption.ts`     | 100%   |
| `src/lib/crypto/key-derivation.ts` | 100%   |
| `src/lib/crypto/storage.ts`        | 100%   |
| `src/stores/auth.ts`               | 100%   |
| `src/stores/network.ts`            | 100%   |
| `src/stores/wallet.ts`             | 100%   |

Every reachable line, statement, branch, and function is covered. Defensive code that cannot be reached in the unit-test environment is marked `/* c8 ignore */` at the source and excluded from the measurement: IndexedDB `onerror` callbacks, the 2-minute API timeout fallback, `typeof window === 'undefined'` SSR guards, and the IDB version-migration branches between v1 and v2 (a fresh fake-indexeddb factory per test only exercises the v0 → v2 path).

## Development

```bash
npm install
npm run dev    # http://localhost:3090
```

## Commands

| Command            | Description                  |
| ------------------ | ---------------------------- |
| `npm run dev`      | Start dev server (port 3090) |
| `npm run build`    | Production build             |
| `npm run lint`     | ESLint + Prettier check      |
| `npm run lint:fix` | Auto-fix lint issues         |

## Project Structure

```
src/
├── app/                # Next.js App Router (layout, pages)
├── components/         # React components
│   ├── Header.tsx      # Logo + network badge
│   ├── WalletCard.tsx  # Balance display + account creation
│   ├── SendForm.tsx    # Coin transfer form
│   ├── TransactionLog.tsx
│   ├── SeedPhraseSetup.tsx   # 12-word mnemonic generation
│   ├── SeedPhraseImport.tsx  # Restore from seed phrase
│   ├── SetPassword.tsx       # Password encryption setup
│   ├── UnlockWallet.tsx      # Unlock encrypted wallet
│   ├── PasskeySetup.tsx      # WebAuthn passkey registration
│   └── Footer.tsx
├── hooks/
│   └── useZkCoins.ts   # WASM integration hook
├── lib/
│   ├── api/
│   │   └── client.ts   # REST API client (backend communication)
│   └── crypto/
│       ├── encryption.ts     # AES-GCM encrypt/decrypt via Web Crypto
│       ├── key-derivation.ts # PBKDF2 from password, HKDF from passkey PRF
│       ├── passkey.ts        # WebAuthn credential create/get + PRF
│       └── storage.ts        # IndexedDB encrypted wallet persistence
└── stores/
    ├── auth.ts          # Zustand store (auth flow state)
    ├── network.ts       # Zustand store (API URL, network name)
    └── wallet.ts        # Zustand store (account, encrypted persistence)

packages/zkcoins-wasm/   # TypeScript wrapper for Rust WASM module
rust/client/             # Rust WASM crate (BIP32, Schnorr, secp256k1)
public/                  # PWA manifest, service worker, icons
```

## API Client

All HTTP requests to the Rust backend go through `src/lib/api/client.ts`. Every response is parsed through a [Zod](https://zod.dev) schema declared in [`src/lib/api/schemas.ts`](src/lib/api/schemas.ts) before it leaves the boundary — drift between the server's shape and what the client expects throws a `ZodError` at the call site instead of leaking through as `undefined` deep inside a render.

There are two layers of contract checking:

- **Compile-time** — the test mocks in `src/__tests__/lib/api/client*.test.ts` are typed via `z.infer<typeof Schema>`, so any change to a schema that the mocks no longer satisfy fails TypeScript.
- **Runtime, opt-in** — `src/__tests__/lib/api/contract.live.test.ts` is skipped by default and runs only when `RUN_API_CONTRACT=true`. It probes the three endpoints that don't need a signed payload (`/api/info`, `/api/mint`, `/api/balance`) against `E2E_API_URL` (default `https://dev-api.zkcoins.app`) and feeds the responses through the schemas. `SendResponseSchema` and `CommitResponseSchema` are aliases of `MintResponseSchema`, so the mint shape covers them too. The `api-contract.yml` workflow runs it on every push to `main` (release-time drift probe), on a weekly cron, and on `workflow_dispatch`.

When the server gains a new field, the client needs no change — `z.object()` defaults to `strip` mode and silently drops unknown keys. When a field is renamed or removed, the schema must change in lock-step with the server release.

## WASM Crypto Module

Real WASM integration with BIP-32 HD wallet, BIP-39 mnemonics, Schnorr signing, public key derivation, and commitment creation. Falls back to JS crypto if WASM fails to load.

To rebuild WASM (requires Rust + Homebrew LLVM for secp256k1 cross-compilation):

```bash
cd rust/client
CC_wasm32_unknown_unknown="/opt/homebrew/opt/llvm/bin/clang" \
AR_wasm32_unknown_unknown="/opt/homebrew/opt/llvm/bin/llvm-ar" \
  wasm-pack build --target web --out-dir ../../packages/zkcoins-wasm/src/pkg
rm packages/zkcoins-wasm/src/pkg/.gitignore  # wasm-pack generates this, must be removed
```

The `pkg/` directory is committed to git (not gitignored) for Docker builds.

## Docker

```bash
docker build -t zkcoin/app .
docker run -p 3090:3090 \
  -e NEXT_PUBLIC_API_URL=https://api.zkcoins.app \
  -e NEXT_PUBLIC_EXPLORER_URL=https://zkcoins.space \
  zkcoin/app
```

Runtime env var injection via `entrypoint.sh` — same image for DEV and PRD.

## CI/CD

| Workflow               | Trigger          | Action                                    |
| ---------------------- | ---------------- | ----------------------------------------- |
| `ci.yaml`              | Push develop, PR | Lint + Build                              |
| `deploy-dev.yaml`      | Push develop     | Docker → `zkcoin/app:beta` → DEV server   |
| `deploy-prd.yaml`      | Push main        | Docker → `zkcoin/app:latest` → PRD server |
| `auto-release-pr.yaml` | Push develop     | Creates Release PR (develop → main)       |

## Open Tasks

- [ ] Account backup/restore
- [ ] Explorer app (`zkcoins.space`)
- [ ] Implement the three Settings stubs (Auto-lock, Auto-rotate receive, Tor routing) — drop their `FEATURES.*` gates from `src/app/settings/page.tsx` once the real handler ships

## Related

| Repo                                                      | Purpose                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| [zk-coins/server](https://github.com/zk-coins/server)     | Rust backend (API, ZK proofs, Bitcoin scanner)               |
| [zk-coins/docs](https://github.com/zk-coins/docs)         | Documentation ([docs.zkcoins.app](https://docs.zkcoins.app)) |
| [zk-coins/research](https://github.com/zk-coins/research) | Protocol research, upstream repos, paper PDF                 |

## Protocol

Based on [Shielded CSV](https://eprint.iacr.org/2025/068) by Jonas Nick (Blockstream), Liam Eagen (Alpen Labs), Robin Linus (ZeroSync). Built on the [ZeroSync prototype](https://github.com/ZeroSync/ZKCoins).

## License

MIT
