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
| Framework | Next.js 14 (App Router)   | SSR, standalone Docker output, largest React ecosystem      |
| Language  | TypeScript (strict)       | Type safety                                                 |
| Styling   | Tailwind CSS              | Dark theme (#0a0a0a), Bitcoin orange (#f7931a)              |
| State     | Zustand                   | Minimal boilerplate, encrypted IndexedDB persistence        |
| Crypto    | Rust → WASM               | secp256k1 + BIP32 from bitcoin crate (same as Bitcoin Core) |
| PWA       | Service Worker + Manifest | Installable, offline-capable, standalone mode               |

Full rationale: [docs.zkcoins.app/tech-decisions](https://docs.zkcoins.app/tech-decisions)

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

## Signup Flow

Two methods, one wallet:

1. **Seed Phrase** — 12 words (BIP-39) → BIP-32 HD Wallet
2. **Passkey** — WebAuthn (Face ID/Touch ID) → seed derivation → BIP-32 HD Wallet

Details: [docs.zkcoins.app/architecture/signup-flow](https://docs.zkcoins.app/architecture/signup-flow)

## Open Tasks

- [x] WASM real integration (BIP-32, BIP-39, Schnorr, commitment creation)
- [x] Two-phase send flow (send → commit)
- [x] E2E tests (Playwright) + unit tests (Vitest)
- [ ] Account backup/restore
- [ ] Explorer app (explorer.zkcoins.app)

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
