# zkCoins App

Web application for [zkcoins.app](https://zkcoins.app) — private Bitcoin transactions via Shielded CSV. Installable as PWA.

## Live

| Environment | URL | Image |
|---|---|---|
| **PRD** | [zkcoins.app](https://zkcoins.app) | `zkcoin/app:latest` |
| **DEV** | [dev.zkcoins.app](https://dev.zkcoins.app) | `zkcoin/app:beta` |
| **Status** | [status.zkcoins.app](https://status.zkcoins.app) | — |

## Stack

| Layer | Technology | Why |
|---|---|---|
| Framework | Next.js 14 (App Router) | SSR, standalone Docker output, largest React ecosystem |
| Language | TypeScript (strict) | Type safety |
| Styling | Tailwind CSS | Dark theme (#0a0a0a), Bitcoin orange (#f7931a) |
| State | Zustand | Minimal boilerplate, localStorage persistence |
| Crypto | Rust → WASM | secp256k1 + BIP32 from bitcoin crate (same as Bitcoin Core) |
| PWA | Service Worker + Manifest | Installable, offline-capable, standalone mode |

Full rationale: [docs.zkcoins.app/tech-decisions](https://docs.zkcoins.app/tech-decisions)

## Development

```bash
npm install
npm run dev    # http://localhost:3090
```

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (port 3090) |
| `npm run build` | Production build |
| `npm run lint` | ESLint + Prettier check |
| `npm run lint:fix` | Auto-fix lint issues |

## Project Structure

```
src/
├── app/                # Next.js App Router (layout, pages)
├── components/         # React components
│   ├── Header.tsx      # Logo + testnet badge
│   ├── WalletCard.tsx  # Balance display + account creation
│   ├── SendForm.tsx    # Coin transfer form
│   └── TransactionLog.tsx
├── hooks/
│   └── useZkCoins.ts   # WASM integration hook
├── lib/api/
│   └── client.ts       # REST API client (backend communication)
└── stores/
    └── wallet.ts        # Zustand store (account, transactions)

packages/zkcoins-wasm/   # TypeScript wrapper for Rust WASM module
rust/client/             # Rust WASM crate (BIP32, Schnorr, secp256k1)
public/                  # PWA manifest, service worker, icons
```

## WASM Crypto Module

Currently using JS fallback. To build real WASM (requires Rust + LLVM with wasm32):

```bash
cd rust/client
CC="/opt/homebrew/opt/llvm/bin/clang" AR="/opt/homebrew/opt/llvm/bin/llvm-ar" \
  cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --out-dir ../../packages/zkcoins-wasm/src/pkg --target web \
  ../target/wasm32-unknown-unknown/release/client.wasm
```

## Docker

```bash
docker build -t zkcoin/app .
docker run -p 3090:3090 \
  -e NEXT_PUBLIC_API_URL=https://api.zkcoins.app \
  -e NEXT_PUBLIC_NETWORK=mainnet \
  zkcoin/app
```

Runtime env var injection via `entrypoint.sh` — same image for DEV and PRD.

## CI/CD

| Workflow | Trigger | Action |
|---|---|---|
| `ci.yaml` | Push develop, PR | Lint + Build |
| `deploy-dev.yaml` | Push develop | Docker → `zkcoin/app:beta` → DEV server |
| `deploy-prd.yaml` | Push main | Docker → `zkcoin/app:latest` → PRD server |
| `auto-release-pr.yaml` | Push develop | Creates Release PR (develop → main) |

## Signup Flow (Planned)

Two methods, one wallet:

1. **Seed Phrase** — 12 words (BIP-39) → BIP-32 HD Wallet
2. **Passkey** — WebAuthn (Face ID/Touch ID) → seed derivation → BIP-32 HD Wallet

Details: [docs.zkcoins.app/architecture/signup-flow](https://docs.zkcoins.app/architecture/signup-flow)

## Open Tasks

- [ ] WASM real integration (currently JS fallback for Schnorr + BIP32)
- [ ] Frontend ↔ API connection (CORS headers in server)
- [ ] BIP-39 seed phrase signup UI (12 words)
- [ ] Passkey signup (WebAuthn)
- [ ] Encrypted key storage (IndexedDB + AES-GCM, replace localStorage)
- [ ] Account backup/restore
- [ ] Explorer app (explorer.zkcoins.app)

## Related

| Repo | Purpose |
|---|---|
| [zk-coins/server](https://github.com/zk-coins/server) | Rust backend (API, ZK proofs, Bitcoin scanner) |
| [zk-coins/docs](https://github.com/zk-coins/docs) | Documentation ([docs.zkcoins.app](https://docs.zkcoins.app)) |
| [zk-coins/research](https://github.com/zk-coins/research) | Protocol research, upstream repos, paper PDF |

## Protocol

Based on [Shielded CSV](https://eprint.iacr.org/2025/068) by Jonas Nick (Blockstream), Liam Eagen (Alpen Labs), Robin Linus (ZeroSync). Built on the [ZeroSync prototype](https://github.com/ZeroSync/ZKCoins).

## License

MIT
