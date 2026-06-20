# zkCoins App

[![Docker Image Version](https://img.shields.io/docker/v/zkcoins/app/latest?logo=docker&label=zkcoins%2Fapp&color=2496ED)](https://hub.docker.com/r/zkcoins/app)
[![Docker Pulls](https://img.shields.io/docker/pulls/zkcoins/app?logo=docker&color=2496ED)](https://hub.docker.com/r/zkcoins/app)

**Private Bitcoin payments via Shielded CSV** — no new chain, no token, no consensus change, no trusted operator. Only Bitcoin, zero-knowledge proofs, and the user's own keys.

The end-user **wallet** for zkCoins — a Next.js 15 PWA. The seed is encrypted on-device (IndexedDB); BIP-32 derivation and Schnorr signing run in an on-device Rust→WASM crate. Installable, LNURL receive.

> Live: [zkcoins.app](https://zkcoins.app) (PRD) · [dev.zkcoins.app](https://dev.zkcoins.app) (DEV) — Full system docs: **[docs.zkcoins.app](https://docs.zkcoins.app)** · Specification: **[docs.zkcoins.app/specification](https://docs.zkcoins.app/specification)**

Container images: **[hub.docker.com/r/zkcoins/app](https://hub.docker.com/r/zkcoins/app)**

## What zkCoins is

zkCoins lets you send value on Bitcoin without anyone seeing the amount, the asset, who paid, or who received. Bitcoin stores only opaque markers that a spend happened — not the coin's contents, which travel privately between sender and receiver as a small encrypted bundle. Double-spend protection is the chain's job; your seed derives every key, your wallet is the only thing that can spend, any node can serve you, and you verify everything against Bitcoin yourself. Built on the zkCoins concept (Robin Linus) and the Shielded CSV construction (Jonas Nick, Liam Eagen, Robin Linus).

## The system, end to end

| Layer                      | What it is                                                                     | Repo                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **App · Explorer**         | end-user wallet (LNURL receive) · public explorer web-app                      | **[`zk-coins/app`](https://github.com/zk-coins/app)** ← this repo · `zk-coins/explorer` _(planned)_         |
| **SDK**                    | thin TypeScript client — on-device keys, signing, node/API calls               | [`zk-coins/sdk`](https://github.com/zk-coins/sdk)                                                           |
| **zkCoins API**            | public REST + LNURL, hosted-wallet service (optional)                          | currently in [`zk-coins/node`](https://github.com/zk-coins/node); a separate API layer is the target design |
| **zkCoins node**           | trustless kernel — scan · accumulator · verify · prove · store · publisher     | [`zk-coins/node`](https://github.com/zk-coins/node)                                                         |
| **bitcoind · Nostr relay** | Bitcoin L1 settlement and ordering · off-chain transport and data availability | upstream (own or external)                                                                                  |

Supporting repos: [`zk-coins/research`](https://github.com/zk-coins/research), [`zk-coins/plonky2`](https://github.com/zk-coins/plonky2), [`zk-coins/docs`](https://github.com/zk-coins/docs).

## This repository (app)

The zkCoins **wallet** — a thin, installable web client. It holds the keys; the node holds the truth.

### Stack

| Layer     | Technology                | Why                                                                |
| --------- | ------------------------- | ------------------------------------------------------------------ |
| Framework | Next.js 15 (App Router)   | SSR, standalone Docker output, largest React ecosystem             |
| Language  | TypeScript (strict)       | Type safety                                                        |
| Styling   | Tailwind CSS              | Dark theme (#0a0a0a), Bitcoin orange (#f7931a)                     |
| State     | Zustand                   | Minimal boilerplate, encrypted IndexedDB persistence               |
| Crypto    | Rust → WASM               | secp256k1 + BIP-32 from the `bitcoin` crate (same as Bitcoin Core) |
| Client    | `@zkcoins/sdk`            | Typed REST/LNURL client, shared response schemas                   |
| PWA       | Service Worker + Manifest | Installable, offline-capable, standalone mode                      |

Full rationale: [docs.zkcoins.app/tech-decisions](https://docs.zkcoins.app/tech-decisions)

### Trust model — your keys on-device, proving on the node

The wallet itself lives **on-device**: seed material is encrypted in IndexedDB (AES-256-GCM), and signing + BIP-32 derivation run inside this app's on-device WASM crate (`secp256k1` from the `bitcoin` crate, in `rust/client`). Wallet creation, restore, unlock, and key custody are local operations — the master xpriv never leaves the device.

**Send / Receive / Mint reach the node.** ZK proof generation runs on the configured zkCoins node (default `https://api.zkcoins.app`, read from `NEXT_PUBLIC_API_URL` in `src/stores/network.ts`). The app posts the full private witness — sender, recipient, amount, in-coin / out-coin slot layout, source aggregator data, account state — and the node returns a proof. The node that proves for you therefore sees your transaction in cleartext.

This is the **Bitcoin full-node model**: your wallet trusts _your_ node, exactly as a Bitcoin wallet trusts your own `bitcoind`. A foreign operator can never steal, forge, or double-spend your coins — that is enforced cryptographically (recursive proofs + Bitcoin-anchored nullifiers). What it can see is your privacy, and it can affect liveness — the same spectrum as using an Electrum/SPV server instead of your own Bitcoin node. The **on-chain footprint stays private regardless**: nullifiers and Taproot inscriptions carry no readable transaction data. The trust boundary is the **node operator**, not the chain.

|                                        | Default (`api.zkcoins.app`)          | Self-hosted node                         |
| -------------------------------------- | ------------------------------------ | ---------------------------------------- |
| Wallet seed location                   | ✅ On-device only                    | ✅ On-device only                        |
| On-chain privacy (vs. block explorers) | ✅                                   | ✅                                       |
| Node sees plaintext transaction data   | ⚠️ Yes — hosted by the node operator | ✅ No — you are the operator             |
| Setup effort                           | ✅ None                              | ⚠️ Run `zk-coins/node` + repoint the app |

**If you need full transaction privacy, point the app at your own node.** Run a node from [`zk-coins/node`](https://github.com/zk-coins/node) and set your URL: `NEXT_PUBLIC_API_URL=https://your-node` (injected at container start by `entrypoint.sh`, or set in `.env.local` for `npm run dev`). The wallet must always be able to switch nodes by changing a single configuration value — that is a hard project rule, mirrored verbatim across the `zk-coins/{node,sdk,app,docs}` `CONTRIBUTING.md` files.

### Thin-client architecture

**The App is a thin client. All authoritative state lives on the node.** Its only jobs are (1) private-key custody — generate/restore the BIP-32 master xpriv, store it encrypted, sign locally with WASM helpers — and (2) UI rendering.

Every other piece of state — balance, send-counter (`num_sends`), transaction history, server capabilities, account proofs — is owned by [`zk-coins/node`](https://github.com/zk-coins/node). Before any signed request (`/api/send`, `/api/commit`, `/api/username/claim`), the app fetches the authoritative `num_sends` from `api.balance(address)` to drive BIP-32 derivation; the Zustand store holds only the cryptographic identity (`xpriv`, `address`) and transient UI state, never a parallel source of truth that can drift. New features go server-side first. Full rationale and the canonical incident that motivated the rule are in [`CONTRIBUTING.md`](CONTRIBUTING.md#architecture-principle--thin-client).

### Develop & build

```bash
npm install
npm run dev      # http://localhost:3090
npm run build    # production build
npm run lint     # ESLint + Prettier check (run before every commit)
npm run lint:fix # auto-fix
```

| Command                 | Description                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run dev`           | Start dev server (port 3090)                                                                                      |
| `npm run build`         | Production build (standalone Next.js output)                                                                      |
| `npm run lint`          | ESLint + Prettier check                                                                                           |
| `npm run test`          | Vitest unit tests (`src/lib/**`, `src/stores/**`)                                                                 |
| `npm run test:coverage` | v8 coverage — CI enforces 100% on the default-active surface (everything not behind a `NEXT_PUBLIC_ENABLE_*` flag)   |
| `npm run test:e2e`      | Playwright E2E against `E2E_BASE_URL`                                                                             |

**Prerequisites:** Node 20+, npm 10+. Rebuilding the WASM crypto crate (`rust/client`) additionally needs Rust 1.81+ and LLVM 21+ with the `wasm32` target — the committed `pkg/` lets you skip this unless you change Rust code. A JS fallback runs if WASM fails to load. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full setup, code style, and WASM build steps.

### Configuration

Both `_URL` variables are injected at **runtime** by `entrypoint.sh`, so one Docker image serves any environment.

| Variable                   | When read       | Default                   | Effect                                                                            |
| -------------------------- | --------------- | ------------------------- | --------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`      | container start | `https://api.zkcoins.app` | zkCoins node API base URL (`src/stores/network.ts`)                               |
| `NEXT_PUBLIC_EXPLORER_URL` | container start | _(empty)_                 | Live network-activity / tx-detail source; empty → `/network` shows simulated data |

Build-time `NEXT_PUBLIC_ENABLE_*` flags exist for local-dev previews of gated UI only — they are not set in the deployed images. Faucet and username UIs are driven at runtime by the node's `GET /api/info.capabilities`, so the same shipped bundle matches whatever Cargo features the connected node was built with. Full table and gating details in [`CONTRIBUTING.md`](CONTRIBUTING.md).

### Docker

```bash
docker build -t zkcoins/app .
docker run -p 3090:3090 \
  -e NEXT_PUBLIC_API_URL=https://api.zkcoins.app \
  -e NEXT_PUBLIC_EXPLORER_URL=https://your-explorer \
  zkcoins/app
```

### Project layout

```
src/
├── app/                # Next.js App Router (pages: send, receive, network, settings, tx/[id], …)
├── components/         # React components (render-only)
├── hooks/useZkCoins.ts # WASM integration hook
├── lib/
│   ├── api/            # @zkcoins/sdk-backed REST client + schemas
│   └── crypto/         # encryption (AES-GCM), key-derivation, passkey, IndexedDB storage
└── stores/             # Zustand: auth, network, wallet, capabilities

packages/zkcoins-wasm/  # local TS wrapper for the Rust WASM crypto module (on-device signing)
rust/client/            # Rust WASM crate (BIP-32, Schnorr, secp256k1)
public/                 # PWA manifest, service worker, icons
e2e/                    # Playwright specs + visual baselines
```

### Branch flow

Feature PRs target **`staging`** (the integration buffer), which is auto-promoted to `develop` → DEV, then `develop` → `main` → PRD via auto-release PRs. `develop` and `main` reject direct pushes. Run `npm run lint` and `npm run build` before pushing. Details in [`CONTRIBUTING.md`](CONTRIBUTING.md#git-workflow).

## Protocol

Based on [Shielded CSV](https://eprint.iacr.org/2025/068) by Jonas Nick, Liam Eagen, and Robin Linus, building on the zkCoins concept. See [`zk-coins/research`](https://github.com/zk-coins/research) and [docs.zkcoins.app/specification](https://docs.zkcoins.app/specification).

## License

MIT — see [`LICENSE`](LICENSE).
