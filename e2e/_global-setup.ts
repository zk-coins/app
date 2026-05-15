/**
 * Runs once before any Playwright worker starts.
 *
 * Mints two fresh wallets (Alice + Bob) by driving the same Create flow
 * the user would. Alice is then seeded via N calls to /api/mint
 * (configurable via E2E_FAUCET_CALLS, default 1). Bob stays empty so the
 * suite has a zero-balance fixture for the empty-state and No-funds
 * screens.
 *
 * Persists the result to `e2e/.fixtures/accounts.json`, which
 * `_helpers/fixtures.ts` reads in each spec.
 *
 * Wired from `playwright.config.ts::globalSetup`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { chromium } from '@playwright/test';
import { api } from './_helpers/api';
import { createSeedWallet, DEFAULT_PASSWORD, clearWalletState } from './_helpers/wallet';
import type { Accounts } from './_helpers/fixtures';

const FIXTURES_DIR = path.join(__dirname, '.fixtures');
const FIXTURES_PATH = path.join(FIXTURES_DIR, 'accounts.json');

const FAUCET_CALLS = Number.parseInt(process.env.E2E_FAUCET_CALLS ?? '1', 10);
const BALANCE_POLL_TIMEOUT_MS = 30_000;
const BALANCE_POLL_INTERVAL_MS = 1_500;

async function pollBalance(address: string): Promise<number> {
  const deadline = Date.now() + BALANCE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const { balance } = await api.balance(address);
      if (balance > 0) return balance;
    } catch {
      /* transient — keep polling */
    }
    await new Promise((r) => setTimeout(r, BALANCE_POLL_INTERVAL_MS));
  }
  throw new Error(
    `globalSetup: balance never rose above 0 for ${address} within ${BALANCE_POLL_TIMEOUT_MS}ms`,
  );
}

async function mintWithRetry(address: string, attempt = 1): Promise<void> {
  const maxAttempts = 3;
  try {
    await api.mint(address);
  } catch (err) {
    if (attempt >= maxAttempts) throw err;
    const wait = 1_000 * 2 ** (attempt - 1);
    console.warn(
      `globalSetup: /api/mint failed (attempt ${attempt}/${maxAttempts}), retrying in ${wait}ms`,
    );
    await new Promise((r) => setTimeout(r, wait));
    return mintWithRetry(address, attempt + 1);
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
    // Alice: fresh wallet, then seed via /api/mint × FAUCET_CALLS.
    const aliceCtx = await browser.newContext({ baseURL });
    const alicePage = await aliceCtx.newPage();
    await clearWalletState(alicePage);
    const alice = await createSeedWallet(alicePage, DEFAULT_PASSWORD);
    await aliceCtx.close();

    for (let i = 0; i < FAUCET_CALLS; i++) {
      await mintWithRetry(alice.address);
    }
    const seededBalance = await pollBalance(alice.address);

    // Bob: fresh wallet, NO seeding.
    const bobCtx = await browser.newContext({ baseURL });
    const bobPage = await bobCtx.newPage();
    await clearWalletState(bobPage);
    const bob = await createSeedWallet(bobPage, DEFAULT_PASSWORD);
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
