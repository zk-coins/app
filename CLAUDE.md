# CLAUDE.md — zkCoins App

Shielded CSV wallet web app for private Bitcoin transactions, live at [zkcoins.app](https://zkcoins.app).

## Tech Stack

- **Framework**: Next.js 14 (App Router, standalone output)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS (dark theme, custom `zkcoins-*` colors, Bitcoin orange `#f7931a`)
- **State**: Zustand (localStorage persistence)
- **Crypto**: Rust WASM (secp256k1, BIP32, Schnorr) with JS fallback
- **PWA**: Service Worker + Manifest (installable, offline-capable)

## Local Development

```bash
npm install
npm run dev          # http://localhost:3090
npm run build        # Production build
npm run lint         # ESLint + Prettier check
npm run lint:fix     # Auto-fix lint issues
```

Prerequisites: Node.js 20+, npm 10+. Rust + LLVM only needed for WASM changes.

## Before Every Commit

1. `npm run lint` — must pass
2. `npm run build` — must succeed
3. Never push if either fails

## Git Workflow

| Branch    | Purpose                             | Deploy                  |
| --------- | ----------------------------------- | ----------------------- |
| `develop` | Default branch, active development  | DEV (`dev.zkcoins.app`) |
| `main`    | Protected, production releases only | PRD (`zkcoins.app`)     |

- Feature branches branch off `develop`, PRs go to `develop`
- `main` receives changes only via auto-created Release PRs
- Never force-push, never amend published commits
- Commits in English, concise, describe _what_ changed

## Docker

- Image: `zkcoin/app`
- Tags: `beta` = DEV (from develop), `latest` = PRD (from main)
- Runtime env injection via `entrypoint.sh` (one image, multiple environments)

## Key Directories

```
src/app/              # Next.js App Router (layout, pages)
src/components/       # React components (Header, WalletCard, SendForm, TransactionLog)
src/hooks/            # React hooks (useZkCoins for WASM integration)
src/lib/api/          # REST API client — never use fetch() directly
src/stores/           # Zustand stores (wallet.ts)
packages/zkcoins-wasm/  # TypeScript wrapper for Rust WASM module
rust/client/          # Rust WASM crate (BIP32, Schnorr, secp256k1)
public/               # PWA manifest, service worker, icons
```

## Code Conventions

- Functional components only, `'use client'` on anything using hooks/state/browser APIs
- Named exports for components, default exports only for pages
- Tailwind only (no CSS files), use `zkcoins-*` custom colors
- All backend calls through `src/lib/api/client.ts` (`api` object)
- WASM cannot run during SSR — use only in `'use client'` components
- No `console.log` in committed code

## Related Repos

| Repo                                                        | Purpose                                        |
| ----------------------------------------------------------- | ---------------------------------------------- |
| [zk-coins/server](https://github.com/zk-coins/server)       | Rust backend (API, ZK proofs, Bitcoin scanner) |
| [zk-coins/docs](https://github.com/zk-coins/docs)           | Documentation (docs.zkcoins.app)               |
| [zk-coins/marketing](https://github.com/zk-coins/marketing) | Marketing website                              |
| [zk-coins/research](https://github.com/zk-coins/research)   | Protocol research, paper PDF                   |
