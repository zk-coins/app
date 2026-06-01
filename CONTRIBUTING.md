# Contributing to zkCoins App

This guide covers everything you need to develop, test, and deploy the zkCoins web application.

## Trust model — node is trusted, wallet is thin

zkCoins is built around a single trust assumption: **the wallet trusts the node it talks to.** The only line the node is not allowed to cross is the wallet's private key — that stays in the wallet. Everything else may be delegated.

This is a hard project rule. It shapes every design and implementation decision:

- **No anti-node logic in the wallet or SDK.** No client-side proof verification, no scan loops, no view-key / spend-key splits, no consistency checks against a second node, no "node integrity" indicators in the UI. If a feature exists to reduce trust in the node, it does not belong in the wallet or SDK.
- **Self-hosting is the escape hatch.** Users who do not want to trust the public operator run their own node. The wallet must always be able to switch to a different node by changing a single configuration value.
- **The node is built so that self-hosting is easy.** Single container, documented configuration, deterministic state, no operator-specific dependencies.
- **The SDK and wallet stay thin.** They expose seed + address + the small set of operations every familiar wallet SDK exposes. Integrators (Cake Wallet, LayerZ, BlueWallet, …) should be able to wire zkCoins up with the same effort as adding a second Bitcoin-family chain.

When in doubt about whether a feature belongs in the wallet, SDK, or node: if it exists to reduce trust in the node, build it node-side, or document self-hosting as the answer. This rule is mirrored verbatim in [`zk-coins/node`](https://github.com/zk-coins/node/blob/develop/CONTRIBUTING.md), [`zk-coins/sdk`](https://github.com/zk-coins/sdk/blob/develop/CONTRIBUTING.md), [`zk-coins/app`](https://github.com/zk-coins/app/blob/develop/CONTRIBUTING.md), and [`zk-coins/docs`](https://github.com/zk-coins/docs/blob/develop/CONTRIBUTING.md).

## Quick Start

```bash
git clone https://github.com/zk-coins/app.git
cd app
npm install
npm run dev    # http://localhost:3090
```

## Prerequisites

| Tool    | Version                | Purpose                                              |
| ------- | ---------------------- | ---------------------------------------------------- |
| Node.js | 20+                    | Runtime                                              |
| npm     | 10+                    | Package manager                                      |
| Rust    | 1.81+                  | WASM crypto module (optional, JS fallback available) |
| LLVM    | 21+ with wasm32 target | secp256k1 C compilation for WASM                     |

## Project Structure

```
app/
├── src/
│   ├── app/               # Next.js App Router (layout, pages)
│   ├── components/        # React components
│   │   ├── Header.tsx
│   │   ├── WalletCard.tsx
│   │   ├── SendForm.tsx
│   │   ├── TransactionLog.tsx
│   │   ├── SeedPhraseSetup.tsx
│   │   ├── SeedPhraseImport.tsx
│   │   ├── SetPassword.tsx
│   │   ├── UnlockWallet.tsx
│   │   ├── PasskeySetup.tsx
│   │   └── Footer.tsx
│   ├── hooks/             # React hooks
│   │   └── useZkCoins.ts  # WASM integration
│   ├── lib/
│   │   ├── api/           # REST API client (backend communication)
│   │   └── crypto/        # Encryption, key derivation, passkey, storage
│   └── stores/            # Zustand state management
│       ├── auth.ts        # Auth flow state
│       ├── network.ts     # API URL, network name
│       └── wallet.ts      # Account, encrypted persistence
├── packages/
│   └── zkcoins-wasm/      # TypeScript wrapper for Rust WASM module
│       └── src/
│           └── index.ts   # WASM API surface + JS fallback
├── rust/
│   └── client/            # Rust WASM crate (BIP32, Schnorr, secp256k1)
├── public/                # Static assets, PWA manifest, service worker
├── Dockerfile             # Multi-stage Next.js build
├── entrypoint.sh          # Runtime env var injection (DEV/PRD)
└── next.config.js         # WASM support, standalone output
```

## Architecture Principle — Thin Client

**The App is a thin client. All authoritative state lives on the node.**

The App's only responsibilities are:

1. **Private key custody** — generate / restore the BIP-32 master xpriv, store it encrypted on the device, sign messages locally with WASM crypto helpers. The xpriv never leaves the device.
2. **UI rendering** — present what the node returns.

Every other piece of state — balance, send-counter (`num_sends`), transaction history, server capabilities, account proofs, commitment lookups — is owned by [`zk-coins/node`](https://github.com/zk-coins/node). The App **MUST** fetch the authoritative value from the node before any operation that depends on it, and **MUST NOT** maintain a parallel local source of truth that can drift.

### Concrete rules

- **Before any signed request** (`/api/send`, `/api/commit`, `/api/username/claim`): call `api.balance(address)` first and use the response's `num_sends` to drive BIP-32 derivation. Reading `account.numPubkeys` from the Zustand store is a bug — the store resets to 0 on every fresh tab, page reload, and Playwright retry; the node's counter is the only value that survives.
- **The Zustand wallet store** holds the cryptographic identity (`xpriv`, `address`) and transient UI state only. It must **NOT** hold a copy of balance-truth, send-counter-truth, transaction-history-truth, or feature-capability-truth. Those come from `/api/balance` (balance, `num_sends`), `/api/info` (capabilities), and (when persistence is needed) the node's `request_log` / `account_history` tables surfaced through dedicated endpoints.
- **New features go server-side first.** If a UI flow needs information the node doesn't already expose, the correct sequence is: add the endpoint to `zk-coins/node`, deploy it to DEV, then consume it in the App. Implementing the logic in the App and "syncing later" is what produced the [`prove_account_update failed`](https://github.com/zk-coins/app/pull/127) class of bugs.
- **Validation, derivation, formatting** that affect protocol-level decisions belong in the WASM crypto layer (`rust/client`) or the node, not in React components. Components are render-only.
- **Drift between App and node:** the node always wins. The App syncs on the next operation.

### Why

The May 2026 `07-send-success` E2E failure is the canonical incident. The App used a local `numPubkeys` counter from the Zustand store; that counter resets to 0 on every fresh page load. After a successful first send (server-side `num_sends → 1`), every Playwright retry / fresh-tab session signed the next send with `pubkey(0)` instead of `pubkey(1)`, violating the in-circuit account-update continuity constraint at [`program-plonky2/src/circuit/main.rs:615-623`](https://github.com/zk-coins/node/blob/develop/program-plonky2/src/circuit/main.rs). Three server-side fixes (`Account.num_sends` counter, server-owned `commitment_public_key`, canonical 64-byte SMT value) all shipped before anyone noticed that the App was still signing with the wrong index. The thin-client rule exists so this class of bug cannot recur: if every signed operation hydrates `num_sends` from `/api/balance` immediately before signing, the local store can never drift far enough to matter.

The api_remote suite (`zk-coins/node/node/tests/api_remote.rs::TestWallet`) threads the BIP-32 index explicitly into every signed request and is therefore immune to the bug — that pattern is the reference implementation for any App-side signed flow.

## Git Workflow

### Branches

| Branch    | Purpose                                                | Deploy target |
| --------- | ------------------------------------------------------ | ------------- |
| `staging` | Integration buffer — feature PRs land here first       | none          |
| `develop` | Active development, promoted from `staging` in batches | DEV server    |
| `main`    | Production releases, promoted from `develop`           | PRD server    |

- **Open feature PRs against `staging`** (not `develop`) — `staging` is the integration buffer where multiple feature branches accumulate before being batched into a single `develop` promotion. This keeps `develop` clean for DEV-deploy churn and gives reviewers a smaller blast radius per merge.
- **`develop` and `main` are protected** — direct pushes are rejected. `develop` accepts only the auto-PR from `staging`; `main` accepts only the auto-PR from `develop`. Hotfixes still go through `staging` so the same review path applies.
- **`develop` is auto-PR'd from `staging`** by `auto-release-pr-staging.yaml` whenever new commits land on `staging`. Merge that PR to promote the batch to DEV.
- **`main` is auto-PR'd from `develop`** by `auto-release-pr.yaml`. Merge to release to PRD.
- Never force-push, never amend published commits.

### Commit Messages

Write in English. Be concise. Describe _what_ changed, not _how_.

```
# Good
Add PWA support: manifest, service worker, icons
Fix runtime env var injection with build-time placeholders
Use DEPLOY_DEV_/DEPLOY_PRD_ secret naming convention

# Bad
update stuff
WIP
fix
```

## Code Style

### TypeScript

- **Strict mode** — `strict: true` in tsconfig
- **Functional components** — no class components
- **`'use client'`** directive on all components that use hooks, state, or browser APIs
- **No `console.log`** in committed code
- **Named exports** for components, default exports only for pages

### Formatting

- **ESLint**: `next lint` (Next.js default rules)
- **Prettier**: single quotes, trailing commas, 100 char width
- Run before every commit:

```bash
npm run lint        # ESLint + Prettier check
npm run lint:fix    # Auto-fix
```

### Imports

```typescript
// 1. React/Next.js
import { useState, useCallback } from 'react';

// 2. Third-party
import { create } from 'zustand';

// 3. Internal (absolute paths via @/)
import { useWalletStore } from '@/stores/wallet';
import { api } from '@/lib/api/client';

// 4. WASM
import { initWasm } from '@zkcoins/wasm';
```

### Component Pattern

```typescript
'use client';

import { useCallback } from 'react';
import { useWalletStore } from '@/stores/wallet';

export function MyComponent() {
  const { account } = useWalletStore();

  const handleAction = useCallback(async () => {
    // ...
  }, []);

  if (!account) return null;

  return (
    <div className="rounded-xl border border-zkcoins-border bg-zkcoins-card p-6">
      {/* content */}
    </div>
  );
}
```

### Styling

- **Tailwind CSS** only — no CSS files, no styled-components
- **Dark theme** — use `zkcoins-*` custom colors from `tailwind.config.ts`
- **Bitcoin orange** — `bg-bitcoin`, `text-bitcoin`, `hover:bg-bitcoin-dark`
- **Consistent spacing** — `p-6` for cards, `gap-3` for form fields, `space-y-6` for sections

| Color          | Tailwind class          | Hex       |
| -------------- | ----------------------- | --------- |
| Background     | `bg-zkcoins-bg`         | `#0a0a0a` |
| Card           | `bg-zkcoins-card`       | `#141414` |
| Border         | `border-zkcoins-border` | `#1f1f1f` |
| Text           | `text-zkcoins-text`     | `#e5e5e5` |
| Muted          | `text-zkcoins-muted`    | `#737373` |
| Bitcoin Orange | `bg-bitcoin`            | `#f7931a` |

### State Management

- **Zustand** for transient UI state and the cryptographic identity only — see the [Thin Client](#architecture-principle--thin-client) rule above for what must NOT live in the store.
- **Encrypted IndexedDB persistence** via `saveEncryptedWallet()` / `loadEncryptedWallet()` (AES-GCM) — for the xpriv and the unlocked-state flags, not for server-owned values.
- **No React Context** for state — Zustand stores are global singletons.
- Wallet store fields: `account` (`xpriv`, `address`), `isLoading`, `isLocked`, `hasStoredWallet`, `storedAddress`, `storedAuthMethod`, `error`. Anything that the node can recompute (balance, `num_sends`, transaction history) is **read from the node on demand**, not cached as ground truth in the store.

### API Client

All backend communication goes through `src/lib/api/client.ts`:

```typescript
import { api } from '@/lib/api/client';

await api.mint(address);
await api.send({ account_address, recipient, amount, public_key, next_public_key });
const { balance } = await api.balance(address);
```

Never call `fetch()` directly — always use the `api` object.

### WASM Integration

The WASM module provides crypto operations (BIP32, Schnorr). It loads asynchronously with a JS fallback:

```typescript
import { initWasm } from '@zkcoins/wasm';

const wasm = await initWasm();
const account = await wasm.createAccount();
```

- WASM cannot run during SSR — all WASM usage must be in `'use client'` components
- The `useZkCoins` hook handles WASM initialization

## Building the WASM Module

Only needed if you change `rust/client/`:

```bash
# Requires Rust + LLVM with wasm32 target
cd rust/client
CC="/opt/homebrew/opt/llvm/bin/clang" AR="/opt/homebrew/opt/llvm/bin/llvm-ar" \
  cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --out-dir ../../packages/zkcoins-wasm/src/pkg --target web \
  ../target/wasm32-unknown-unknown/release/client.wasm
```

## Docker

The app runs as a standalone Next.js container:

```bash
docker build -t zkcoins/app .
docker run -p 3090:3090 \
  -e NEXT_PUBLIC_API_URL=https://api.zkcoins.app \
  -e NEXT_PUBLIC_EXPLORER_URL=https://zkcoins.space \
  zkcoins/app
```

Environment variables are injected at **runtime** via `entrypoint.sh` — the same image works for DEV and PRD.

### Build-time Placeholders

The Dockerfile sets placeholder values at build time (`NEXT_PUBLIC_API_URL_PLACEHOLDER`). The `entrypoint.sh` replaces them with actual values at container start. This pattern allows one image for multiple environments.

## CI/CD

| Workflow                       | Trigger             | Action                                                   |
| ------------------------------ | ------------------- | -------------------------------------------------------- |
| `ci.yaml`                      | Push to develop, PR | Lint + Build                                             |
| `deploy-dev.yaml`              | Push to develop     | Docker build → push `zkcoins/app:beta` → deploy to DEV   |
| `deploy-prd.yaml`              | Push to main        | Docker build → push `zkcoins/app:latest` → deploy to PRD |
| `auto-release-pr-staging.yaml` | Push to staging     | Creates Promote PR (staging → develop)                   |
| `auto-release-pr.yaml`         | Push to develop     | Creates Release PR (develop → main)                      |

### Before Pushing

Always run locally:

```bash
npm run lint     # Must pass
npm run build    # Must succeed
```

Never push if lint or build fails.

## PWA

The app is a Progressive Web App:

- `public/manifest.json` — app metadata, icons, theme color
- `public/sw.js` — service worker (cache-first for assets, network-first for API)
- `public/icons/` — 192px and 512px icons

Changes to the service worker require incrementing `CACHE_NAME` in `sw.js`.

## Related Repos

- [zk-coins/node](https://github.com/zk-coins/node) — Rust backend (API)
- [zk-coins/docs](https://github.com/zk-coins/docs) — Documentation (docs.zkcoins.app)
