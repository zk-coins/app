/**
 * Runs once before any Playwright worker starts.
 *
 * Mints two fresh wallets (Alice + Bob) by driving the same Create flow
 * the user would. Alice is then seeded by creating her OWN asset via the
 * neutral multi-asset create-coin flow (creator-signed mint: admit
 * POST /api/jobs/mint → commit → poll to completed, configurable via
 * E2E_FAUCET_CALLS, default 1). There is no faucet under the neutral
 * multi-asset model — a wallet funds itself by minting an asset it owns.
 * Bob stays empty so the suite has a zero-portfolio fixture for the
 * empty-state and No-funds screens.
 *
 * Persists the result to `e2e/.fixtures/accounts.json`, which
 * `_helpers/fixtures.ts` reads in each spec.
 *
 * Wired from `playwright.config.ts::globalSetup`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BrowserContext, FullConfig, Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { api } from './_helpers/api';
import { createSeedWallet, DEFAULT_PASSWORD, clearWalletState } from './_helpers/wallet';
import type { Accounts } from './_helpers/fixtures';

const FIXTURES_DIR = path.join(__dirname, '.fixtures');
const FIXTURES_PATH = path.join(FIXTURES_DIR, 'accounts.json');

const FAUCET_CALLS = Number.parseInt(process.env.E2E_FAUCET_CALLS ?? '1', 10);
// Bumped from 30 s to 90 s — the DEV mint flow on Mutinynet sometimes
// takes longer than 30 s (server-side ZK proof gen + Bitcoin broadcast
// + scanner re-detects the inscription). On slow days we burn through
// the budget before the balance actually rises.
const BALANCE_POLL_TIMEOUT_MS = 90_000;
const BALANCE_POLL_INTERVAL_MS = 1_500;

/** Poll the owner's portfolio until its total balance across all assets
 *  rises above 0 (the create-coin mint has settled). */
async function pollPortfolioFunded(address: string): Promise<number> {
  const deadline = Date.now() + BALANCE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const { assets } = await api.ownerBalances(address);
      const total = assets.reduce((sum, a) => sum + a.balance, 0);
      if (total > 0) return total;
    } catch {
      /* transient — keep polling */
    }
    await new Promise((r) => setTimeout(r, BALANCE_POLL_INTERVAL_MS));
  }
  throw new Error(
    `globalSetup: portfolio never funded for ${address} within ${BALANCE_POLL_TIMEOUT_MS}ms`,
  );
}

/** Run the creator-signed create-coin flow for `mnemonic`'s wallet, with a
 *  small retry on transient admit/proof failures. Each call mints a fresh,
 *  uniquely-named asset (the helper auto-generates the name). Returns the
 *  wallet's Poseidon owner address — the one the node credits and the one
 *  the portfolio poll must query. */
async function createCoinWithRetry(mnemonic: string, attempt = 1): Promise<string> {
  const maxAttempts = 3;
  try {
    const { address } = await api.createCoin(mnemonic);
    return address;
  } catch (err) {
    if (attempt >= maxAttempts) throw err;
    const wait = 1_000 * 2 ** (attempt - 1);
    console.warn(
      `globalSetup: create-coin failed (attempt ${attempt}/${maxAttempts}), retrying in ${wait}ms`,
    );
    await new Promise((r) => setTimeout(r, wait));
    return createCoinWithRetry(mnemonic, attempt + 1);
  }
}

/**
 * Retry-wrapped `/api/info` — the DEV API sometimes returns a transient
 * Cloudflare 502 / 504 while the worker behind it cycles. A single
 * GET shouldn't fail the whole regen run; 5 retries × 2 s backoff
 * cover everything we've seen in practice.
 */
async function infoWithRetry(attempt = 1): Promise<{ network: string }> {
  const maxAttempts = 5;
  try {
    return await api.info();
  } catch (err) {
    if (attempt >= maxAttempts) throw err;
    const wait = 2_000 * attempt;
    console.warn(
      `globalSetup: /api/info failed (attempt ${attempt}/${maxAttempts}), retrying in ${wait}ms`,
    );
    await new Promise((r) => setTimeout(r, wait));
    return infoWithRetry(attempt + 1);
  }
}

/**
 * Cold-start hardening for browser contexts used in globalSetup.
 *
 * The first `page.goto('/')` after a CI runner boot occasionally exceeds
 * Playwright's default 30 s navigation timeout — Cloudflare cold path,
 * Next.js standalone first-paint, plus the WASM bundle handshake all
 * stack on the very first request. Subsequent navigations in the same
 * context are fast. Bumping the context-wide default to 90 s costs
 * nothing on the happy path and removes a class of flake that only
 * shows up in globalSetup, not in the test specs themselves.
 *
 * Scoped to globalSetup only — the specs keep the 30 s default so a
 * genuine app-side regression still surfaces as a timeout instead of
 * being masked by a wide budget.
 */
function applyColdStartTimeouts(ctx: BrowserContext): void {
  ctx.setDefaultNavigationTimeout(90_000);
  ctx.setDefaultTimeout(60_000);
}

/**
 * Wrap a globalSetup page-driving step in a single retry so a transient
 * first-paint timeout doesn't fail the whole CI run. The retry creates
 * a fresh page on the same context — the previous one may be left in
 * a half-loaded state after the abort. The `finally` block closes the
 * page on every iteration (success, retry, or terminal throw) so
 * pages never accumulate even if the caller delays `ctx.close()`.
 */
async function withPageRetry<T>(
  ctx: BrowserContext,
  label: string,
  step: (page: Page) => Promise<T>,
): Promise<T> {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const page = await ctx.newPage();
    try {
      return await step(page);
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.warn(`globalSetup: ${label} failed on attempt ${attempt}, retrying. ${String(err)}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
  throw new Error(`globalSetup: ${label} exhausted retries`);
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  // Opt-in. The legacy specs (wallet.spec.ts, send-flow.spec.ts,
  // settings.spec.ts, visual.spec.ts, webauthn.spec.ts) create their
  // own wallets and don't need pre-minted fixtures. The new exhaustive
  // suite (01-onboarding-welcome.spec.ts onwards) needs Alice + Bob
  // and sets E2E_NEED_FIXTURES=true in its workflow env.
  //
  // Running globalSetup unconditionally on every CI invocation would
  // add 30-60 s of network work plus dependency on /api/info to runs
  // that don't need it.
  if (process.env.E2E_NEED_FIXTURES !== 'true') {
    return;
  }

  const baseURL = config.projects[0]?.use.baseURL ?? process.env.E2E_BASE_URL;
  if (!baseURL) throw new Error('globalSetup: no baseURL configured');

  // Refuse to run against mainnet — Alice can't be seeded there.
  const info = await infoWithRetry();
  if (info.network === 'mainnet') {
    throw new Error(
      `globalSetup: refusing to seed accounts on mainnet (E2E_API_URL=${process.env.E2E_API_URL ?? 'default'}). ` +
        `Point at a testnet (signet) API or run an MVP smoke spec instead.`,
    );
  }

  const browser = await chromium.launch();
  try {
    // Alice: fresh wallet, then seed via /api/jobs/mint × FAUCET_CALLS.
    const aliceCtx = await browser.newContext({ baseURL });
    applyColdStartTimeouts(aliceCtx);
    const alice = await withPageRetry(aliceCtx, 'create Alice wallet', async (page) => {
      await clearWalletState(page);
      return await createSeedWallet(page, DEFAULT_PASSWORD);
    });
    await aliceCtx.close();

    // Seed Alice by minting her own asset(s) via the create-coin flow. The
    // mint credits `owner = Poseidon(creator_pubkey)`; the create-coin helper
    // derives that owner via the SAME `@zkcoins/wasm` path the app uses, so
    // `mintedAddress` is the address the node credits AND the address the live
    // wallet polls. It must equal `alice.address` (read off the wallet UI
    // chip) — assert that so a future address-derivation drift fails loud here
    // rather than silently regenerating empty portfolio baselines.
    let mintedAddress = '';
    for (let i = 0; i < FAUCET_CALLS; i++) {
      mintedAddress = await createCoinWithRetry(alice.mnemonic.join(' '));
    }
    if (mintedAddress && alice.address && mintedAddress !== alice.address) {
      throw new Error(
        `globalSetup: wasm-derived mint owner (${mintedAddress}) != wallet UI address ` +
          `(${alice.address}). The app and the e2e helper derive the wallet address ` +
          `differently — the portfolio screen would never show the minted asset.`,
      );
    }
    const seededBalance = await pollPortfolioFunded(mintedAddress || alice.address);

    // Bob: fresh wallet, NO seeding.
    const bobCtx = await browser.newContext({ baseURL });
    applyColdStartTimeouts(bobCtx);
    const bob = await withPageRetry(bobCtx, 'create Bob wallet', async (page) => {
      await clearWalletState(page);
      return await createSeedWallet(page, DEFAULT_PASSWORD);
    });
    await bobCtx.close();

    const accounts: Accounts = {
      alice: { ...alice, seededBalance },
      bob,
    };

    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    fs.writeFileSync(FIXTURES_PATH, JSON.stringify(accounts, null, 2));

    console.log(
      `globalSetup: Alice ${alice.address} (${seededBalance} sats)  Bob ${bob.address} (0 sats)`,
    );
  } finally {
    await browser.close();
  }
}
