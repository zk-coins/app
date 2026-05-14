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

## Features

User-facing functions, their activation status, and the tests that cover them.

**Status legend** (current behaviour): `always` = hard-coded on · `env` = togglable via `NEXT_PUBLIC_*` env var · `settings` = togglable via in-app Settings · `planned` = UI present but disabled · `dev` = dev/demo route, not in nav.

**Triage legend** (target state for MVP): `mvp` = in scope, must reach full test coverage before launch · `gate (VAR)` = to be hidden behind the named env var (default off) until tests exist · `planned` = not in scope for MVP · `keep` = current gating already adequate, no migration needed.

**Coverage legend:** unit % refers to Vitest line coverage of the lowest-covered involved file in `src/lib/**` + `src/stores/**` (Components are excluded from coverage scope). `e2e` means a Playwright spec covers the flow. `—` means no test exists.

| Feature                        | Status  | Triage                                     | Tests                  |
| ------------------------------ | ------- | ------------------------------------------ | ---------------------- |
| Create wallet — seed phrase    | always  | mvp                                        | 88% · e2e              |
| Create wallet — passkey        | always  | gate (`NEXT_PUBLIC_ENABLE_PASSKEY`)        | 14% · e2e              |
| Restore wallet — seed phrase   | always  | mvp                                        | 88% · e2e              |
| Restore wallet — passkey       | always  | gate (`NEXT_PUBLIC_ENABLE_PASSKEY`)        | 14% · e2e              |
| Unlock wallet — password       | always  | mvp                                        | 100% · —               |
| Unlock wallet — passkey        | always  | gate (`NEXT_PUBLIC_ENABLE_PASSKEY`)        | 14% · e2e              |
| Disconnect wallet              | always  | mvp                                        | 88% · e2e              |
| View balance                   | always  | mvp                                        | 88% · e2e              |
| View transaction history       | always  | mvp                                        | 88% · e2e              |
| Send Bitcoin (2-phase)         | always  | mvp                                        | 88% · e2e              |
| Receive Bitcoin (address + QR) | always  | mvp                                        | 100% · e2e             |
| Mint test BTC (faucet)         | always¹ | gate (`NEXT_PUBLIC_ENABLE_FAUCET`)         | 99% · e2e              |
| Claim username                 | always  | gate (`NEXT_PUBLIC_ENABLE_USERNAMES`)      | 99% · e2e              |
| Resolve username (in Send)     | always  | gate (`NEXT_PUBLIC_ENABLE_USERNAMES`)      | 99% · e2e              |
| Network info badge             | always  | mvp                                        | 100% · e2e             |
| Network activity chart         | env²    | keep                                       | 0% · e2e (visual only) |
| Install as PWA                 | always  | mvp                                        | —                      |
| Apps directory                 | always  | gate (`NEXT_PUBLIC_ENABLE_APPS_DIRECTORY`) | e2e (visual only)      |
| Auto-lock                      | planned | planned                                    | —                      |
| Auto-rotate addresses          | planned | planned                                    | —                      |
| Tor routing                    | planned | planned                                    | —                      |
| `/reset` — wipe local state    | dev³    | gate (`NEXT_PUBLIC_ENABLE_DEV_ROUTES`)     | —                      |
| `/simulate` — demo populate    | dev³    | gate (`NEXT_PUBLIC_ENABLE_DEV_ROUTES`)     | —                      |

¹ Faucet button is auto-hidden when `/api/info` reports `network = mainnet`. No flag today — runtime check.
² `NEXT_PUBLIC_EXPLORER_URL` empty (default) → simulated data is shown; URL set → live chart is fetched from the explorer.
³ Dev/demo routes, always reachable but not part of the user-facing nav.

### Triage gaps

Features tagged `mvp` whose current test coverage is insufficient — these block "100% on activated features":

- **Unlock wallet — password** — unit covers the crypto path, but no E2E exercises the unlock screen
- **Install as PWA** — no automated test (browser-native install prompt, hard to exercise in CI)

Env vars that need to be implemented to honour the `gate (…)` decisions above:

- `NEXT_PUBLIC_ENABLE_PASSKEY` — gates the three passkey flows (create / restore / unlock). Default off
- `NEXT_PUBLIC_ENABLE_FAUCET` — gates the Mint button (replaces the current runtime mainnet check). Default off
- `NEXT_PUBLIC_ENABLE_USERNAMES` — gates Username claim + the `@`/`$` resolver in Send. Default off
- `NEXT_PUBLIC_ENABLE_APPS_DIRECTORY` — gates the `/apps` route + nav entry. Default off
- `NEXT_PUBLIC_ENABLE_DEV_ROUTES` — gates `/reset` and `/simulate`. Default off

Until the gates are wired, the listed `gate (…)` features still run unconditionally; the Triage column is the agreed target, not the current code state.

### Details

#### Create wallet — seed phrase

- **UI:** `src/components/onboarding/Onboarding.tsx` (`SeedFlow`) reached from `src/app/page.tsx`
- **Crypto:** `@zkcoins/wasm` (`generateMnemonic`, `createAccountFromMnemonic`), `src/lib/crypto/encryption.ts`, `src/lib/crypto/key-derivation.ts`
- **Storage:** `src/lib/crypto/storage.ts` (encrypted IndexedDB blob), `src/stores/wallet.ts::saveWithPassword`
- **APIs:** `GET /api/balance` (optional initial balance fetch)
- **Tests:** unit `src/__tests__/lib/crypto/encryption.test.ts`, `key-derivation.test.ts`, `storage.test.ts`, `stores/wallet.test.ts` — e2e `e2e/wallet.spec.ts`

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
- **Tests:** unit (same as create) — e2e `e2e/wallet.spec.ts` (`navigates to seed phrase import`)

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
- **Tests:** unit `encryption.test.ts`, `storage.test.ts` — no E2E (E2E suites stay unlocked across runs)

#### Unlock wallet — passkey

- **UI:** UnlockScreen
- **Crypto:** `authenticatePasskey`, `unlockWithPrf`
- **Tests:** unit `passkey.test.ts` — e2e `e2e/webauthn.spec.ts`

#### Disconnect wallet

- **UI:** `src/app/settings/page.tsx` (Disconnect button + `window.confirm`)
- **Implementation:** `deleteWallet`, `deleteCredential`, `useAuthStore.reset()`
- **Tests:** unit `stores/wallet.test.ts`, `stores/auth.test.ts` — e2e `e2e/settings.spec.ts`

#### View balance

- **UI:** `src/components/screens/WalletScreen.tsx` (balance card with 5 s polling, eye toggle to hide/show)
- **Implementation:** `api.balance()`, `format.ts::formatBtc/formatUsd`, `useWalletStore.setBalance`
- **APIs:** `GET /api/balance?address=<hex>`
- **Tests:** unit `client.test.ts`, `format.test.ts`, `format-full.test.ts`, `wallet.test.ts` — e2e `e2e/send-flow.spec.ts`

#### View transaction history

- **UI:** `WalletScreen.tsx` (TransactionsList, icons per type, BTC compact format)
- **Implementation:** `useWalletStore.transactions` persisted under `zkcoins_transactions` in localStorage
- **Tests:** unit `wallet-transactions.test.ts` — e2e `send-flow.spec.ts` (asserts list renders)

#### Send Bitcoin (2-phase)

- **UI:** `src/app/send/page.tsx` (recipient, amount, confirm dialog)
- **Implementation:** `signSendRequest` (Schnorr) → `api.sendSigned` → client commitment (`Schnorr(hash(account_state_hash || output_coins_root))`) → `api.commit`. In-flight commit recovery via `zkcoins_inflight_commit` in localStorage (3 attempts, exp. backoff)
- **APIs:** `POST /api/send`, `POST /api/commit`, `GET /api/username/resolve/:name` (if recipient starts with `@` or `$`)
- **Tests:** unit `client-signing.test.ts`, `client-username.test.ts`, `wallet-transactions.test.ts` — e2e `send-flow.spec.ts` (`Send Page` suite)

#### Receive Bitcoin (address + QR)

- **UI:** `src/app/receive/page.tsx` (`toZkAddress`, QRCodeSVG, copy-to-clipboard)
- **Implementation:** `format.ts::toZkAddress`
- **Tests:** unit `format.test.ts` — e2e `send-flow.spec.ts` (`Receive Page` suite)

#### Mint test BTC (faucet)

- **UI:** `WalletScreen.tsx` empty-state banner with "Get test sats" button
- **Visibility:** Auto-hidden when `useNetworkStore.networkName === 'mainnet'`. No flag — runtime check against `/api/info`
- **Implementation:** `api.mint()`
- **APIs:** `POST /api/mint`, `GET /api/info` (network detection)
- **Tests:** unit `client.test.ts`, `network.test.ts` — e2e `send-flow.spec.ts` (asserts button visible on testnet)

#### Claim username

- **UI:** `WalletScreen.tsx` (claim button + input)
- **Implementation:** `signClaimRequest` (Schnorr with pubkey_0) → `api.claimUsername`
- **APIs:** `POST /api/username/claim`
- **Tests:** unit `client-username.test.ts` — e2e `send-flow.spec.ts` (`Wallet Address Display` suite)

#### Resolve username (in Send)

- **UI:** Send page input — recipient starting with `@` or `$` triggers resolution before signing
- **Implementation:** `api.resolveUsername`
- **APIs:** `GET /api/username/resolve/:username`
- **Tests:** unit `client-username.test.ts` — e2e implicit via `send-flow.spec.ts`

#### Network info badge

- **UI:** `WalletScreen.tsx` + `src/app/settings/page.tsx`
- **Implementation:** `useNetworkStore` hydrated from `/api/info` on mount
- **APIs:** `GET /api/info`
- **Tests:** unit `stores/network.test.ts` — e2e `e2e/settings.spec.ts`

#### Network activity chart

- **UI:** `src/app/network/page.tsx` (`NetworkActivity` component, 6 h window, 8 s polling)
- **Activation:** `NEXT_PUBLIC_EXPLORER_URL` empty → simulated data with `Preview · simulated` badge; URL set → live data fetched from explorer's `/network/activity?window_ms=…`
- **Implementation:** `src/lib/api/explorer.ts` + `src/lib/simulate-network.ts`
- **Tests:** unit — none for explorer fetcher (depends on external service); simulator also uncovered — e2e `e2e/visual.spec.ts` (visual regression only)

#### Install as PWA

- **UI:** `src/components/PwaPrompt.tsx` (handles `beforeinstallprompt`), manifest + service worker in `public/`
- **Tests:** none (browser-native install prompt — not exercisable in CI)

#### Apps directory

- **UI:** `src/app/apps/page.tsx` (static list with external links: DFX, OpenCryptoPay)
- **Tests:** e2e `e2e/visual.spec.ts` (visual regression only — no functional assertions on links)

#### Planned (UI present, disabled)

The Settings screen renders three toggles with `disabled={true}` and a `Planned` badge. They have no runtime effect:

- **Auto-lock** — would clear in-memory keys after inactivity
- **Auto-rotate addresses** — would derive a fresh receiving pubkey per send
- **Tor routing** — would proxy all server traffic through Tor

#### Dev/demo routes

Reachable by direct URL, not in the nav. Not intended for end users.

- **`/reset`** — `src/app/reset/page.tsx` calls `deleteWallet`, `deleteCredential`, `resetAuth` on mount, then redirects home
- **`/simulate`** — `src/app/simulate/page.tsx` creates an account and fills `populateDemoHistory` (8 sample transactions) for screenshot/demo use

### Configuration

| Variable                   | Default                   | Effect                                                                  |
| -------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`      | `https://api.zkcoins.app` | Backend API base URL. Injected at container start via `entrypoint.sh`   |
| `NEXT_PUBLIC_EXPLORER_URL` | _(empty)_                 | Live network activity source. Empty → `/network` shows simulated data   |
| `E2E_BASE_URL`             | `https://dev.zkcoins.app` | Playwright target URL — test-time only, not consumed by the running app |

No build-time feature flags. All gating is runtime: env-injected URLs or runtime API responses (e.g. faucet hidden on mainnet).

### Tests

| Stack       | Command                 | What it covers                                                                                                    |
| ----------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Vitest + v8 | `npm run test`          | 144 unit tests across `src/lib/**` and `src/stores/**`                                                            |
| Coverage    | `npm run test:coverage` | v8 line coverage. Latest run: **67.8% stmts · 69.5% lines** (scope excludes `src/components/**` and `src/app/**`) |
| Playwright  | `npm run test:e2e`      | 5 suites — `wallet`, `send-flow`, `webauthn`, `settings`, `visual`. Runs against `E2E_BASE_URL`                   |
| Playwright  | `npm run test:visual`   | Visual regression subset only                                                                                     |

Per-file unit coverage (latest run):

| File                               | Line % |
| ---------------------------------- | ------ |
| `src/lib/format.ts`                | 100%   |
| `src/lib/api/client.ts`            | 98.6%  |
| `src/lib/api/explorer.ts`          | 0%     |
| `src/lib/crypto/encryption.ts`     | 100%   |
| `src/lib/crypto/key-derivation.ts` | 100%   |
| `src/lib/crypto/passkey.ts`        | 13.7%  |
| `src/lib/crypto/storage.ts`        | 100%   |
| `src/lib/simulate.ts`              | 0%     |
| `src/lib/simulate-network.ts`      | 0%     |
| `src/stores/auth.ts`               | 100%   |
| `src/stores/network.ts`            | 100%   |
| `src/stores/wallet.ts`             | 87.8%  |

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
  -e NEXT_PUBLIC_EXPLORER_URL=https://explorer.zkcoins.app \
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
- [ ] Explorer app (`explorer.zkcoins.app`)
- [ ] Wire up the three Settings toggles currently marked `planned` (Auto-lock, Auto-rotate, Tor)

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
