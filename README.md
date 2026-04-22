# zkCoins App

Web application for [zkcoins.app](https://zkcoins.app) — private Bitcoin transactions via Shielded CSV.

## Stack

- Next.js 14 (App Router), React 18, TypeScript
- Tailwind CSS (dark theme, Bitcoin orange)
- Zustand (state management, localStorage persistence)
- Rust → WebAssembly (BIP32 HD wallets, Schnorr signatures)

## Development

```bash
npm install
npm run dev    # http://localhost:3090
```

## Build

```bash
npm run build
npm start
```

## WASM Crypto Module

The `packages/zkcoins-wasm/` directory contains a TypeScript wrapper around the Rust crypto library (`rust/client/`). To rebuild WASM:

```bash
cd rust/client
CC="/opt/homebrew/opt/llvm/bin/clang" AR="/opt/homebrew/opt/llvm/bin/llvm-ar" \
  cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --out-dir ../../packages/zkcoins-wasm/src/pkg --target web \
  ../target/wasm32-unknown-unknown/release/client.wasm
```

## Related Repos

- [zk-coins/server](https://github.com/zk-coins/server) — Rust/Axum backend
- [zk-coins/docs](https://github.com/zk-coins/docs) — Documentation (docs.zkcoins.app)

## License

MIT
