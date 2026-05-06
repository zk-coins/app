# Contributing to zkCoins App

This guide covers everything you need to develop, test, and deploy the zkCoins web application.

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

## Git Workflow

### Branches

| Branch    | Purpose                            | Deploy target |
| --------- | ---------------------------------- | ------------- |
| `develop` | Default branch, active development | DEV server    |
| `main`    | Production releases                | PRD server    |

- **Push to `develop` via feature branch + PR** (branch ruleset active) — no PR required for regular work
- **`main` is protected** — changes only via PR (auto-created by Release PR workflow)
- Never force-push, never amend published commits

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

- **Zustand** for all application state
- **Encrypted IndexedDB persistence** via `saveEncryptedWallet()` / `loadEncryptedWallet()` (AES-GCM)
- **No React Context** for state — Zustand stores are global singletons
- Wallet state: `account`, `transactions`, `isLoading`, `isLocked`, `hasStoredWallet`, `storedAddress`, `storedAuthMethod`, `error`

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
docker build -t zkcoin/app .
docker run -p 3090:3090 \
  -e NEXT_PUBLIC_API_URL=https://api.zkcoins.app \
  -e NEXT_PUBLIC_EXPLORER_URL=https://explorer.zkcoins.app \
  zkcoin/app
```

Environment variables are injected at **runtime** via `entrypoint.sh` — the same image works for DEV and PRD.

### Build-time Placeholders

The Dockerfile sets placeholder values at build time (`NEXT_PUBLIC_API_URL_PLACEHOLDER`). The `entrypoint.sh` replaces them with actual values at container start. This pattern allows one image for multiple environments.

## CI/CD

| Workflow               | Trigger             | Action                                                  |
| ---------------------- | ------------------- | ------------------------------------------------------- |
| `ci.yaml`              | Push to develop, PR | Lint + Build                                            |
| `deploy-dev.yaml`      | Push to develop     | Docker build → push `zkcoin/app:beta` → deploy to DEV   |
| `deploy-prd.yaml`      | Push to main        | Docker build → push `zkcoin/app:latest` → deploy to PRD |
| `auto-release-pr.yaml` | Push to develop     | Creates Release PR (develop → main)                     |

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

- [zk-coins/server](https://github.com/zk-coins/server) — Rust backend (API)
- [zk-coins/docs](https://github.com/zk-coins/docs) — Documentation (docs.zkcoins.app)
