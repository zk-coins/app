/**
 * Runs once before any Playwright worker starts.
 *
 * Mints two fresh wallets (Alice + Bob) by driving the same Create flow
 * the user would. Alice is then seeded by creating her OWN asset via the
 * neutral multi-asset create-coin flow (creator-signed mint: POST /v1/tx
 * kind=mint → await signature → complete, configurable via
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
import {
  createSeedWallet,
  restoreSeedWallet,
  DEFAULT_PASSWORD,
  clearWalletState,
} from './_helpers/wallet';
import type { Accounts } from './_helpers/fixtures';

const FIXTURES_DIR = path.join(__dirname, '.fixtures');
const FIXTURES_PATH = path.join(FIXTURES_DIR, 'accounts.json');

const FAUCET_CALLS = Number.parseInt(process.env.E2E_FAUCET_CALLS ?? '1', 10);

/**
 * Portfolio / balance reads are not available until AccountState decode
 * ships. Fixture funding is verified by mint job completion only; seeded
 * balance is recorded as null so specs do not treat a fabricated 0 as
 * wallet truth.
 */
async function noteFundingUnavailable(address: string): Promise<null> {
  void address;
  return null;
}

/** Run the creator-signed create-coin flow for `mnemonic`'s wallet.
 *  Pre-sign retries live in `api.createCoin` (same name, no post-submit
 *  remint). Without `opts.name` the helper generates a unique name once;
 *  the single-asset leg passes a deterministic fixture name instead.
 *  Returns the wallet's Poseidon owner address. */
async function createCoinWithRetry(
  mnemonic: string,
  opts: { name?: string } = {},
): Promise<string> {
  const { address } = await api.createCoin(mnemonic, opts);
  return address;
}

/**
 * Retry-wrapped `/v1/info` — the DEV API sometimes returns a transient
 * Cloudflare 502 / 504 while the worker behind it cycles. A single
 * GET shouldn't fail the whole regen run; 5 retries × 2 s backoff
 * cover everything we've seen in practice.
 */
async function infoWithRetry(
  attempt = 1,
): Promise<{ network: string; capabilities?: { multi_asset?: boolean } }> {
  const maxAttempts = 5;
  try {
    return await api.info();
  } catch (err) {
    if (attempt >= maxAttempts) throw err;
    const wait = 2_000 * attempt;
    console.warn(
      `globalSetup: /v1/info failed (attempt ${attempt}/${maxAttempts}), retrying in ${wait}ms`,
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
 * Next.js standalone first-paint and the first SDK/network handshake all
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
  // add 30-60 s of network work plus dependency on /v1/info to runs
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
        `Point at a non-mainnet v1 network (testnet|regtest) or run a smoke spec instead.`,
    );
  }

  // Branch the seeding strategy on the REPORTED multi-asset capability.
  // The E2E api helper hits E2E_API_URL (the info-proxy in CI, which
  // sets `multi_asset: true` and passes all other /v1/* through 1:1).
  // Either way the seed itself is the creator-signed create-coin flow —
  // the node's neutral permissionless model has no server-mediated faucet,
  // so a wallet is funded by minting an asset it owns. Confirm funding by
  // mint completion only — do not poll walletBalance / portfolio.
  // The branches differ only in which assets are minted:
  //   - false → single-asset UI mode: mint ONE deterministic fixture asset.
  //   - true  → multi-asset UI mode: mint uniquely-named assets.
  const multiAsset = info.capabilities?.multi_asset === true;

  const browser = await chromium.launch();
  try {
    // Alice: fresh wallet, then seed via the creator-signed
    // POST /v1/tx kind=mint (admit → sign → completed) × FAUCET_CALLS.
    const aliceCtx = await browser.newContext({ baseURL });
    applyColdStartTimeouts(aliceCtx);
    const alice = await withPageRetry(aliceCtx, 'create Alice wallet', async (page) => {
      await clearWalletState(page);
      const raw = process.env.E2E_ALICE_MNEMONIC?.trim();
      const preset = raw ? raw.split(/\s+/) : [];
      if (preset.length === 12) {
        return { ...(await restoreSeedWallet(page, preset, DEFAULT_PASSWORD)), mnemonic: preset };
      }
      if (raw) {
        throw new Error(
          `globalSetup: E2E_ALICE_MNEMONIC is set but has ${preset.length} words (need 12).`,
        );
      }
      return await createSeedWallet(page, DEFAULT_PASSWORD);
    });
    await aliceCtx.close();

    // Write-side mint for Alice when FAUCET_CALLS > 0. Failures are fatal:
    // a broken /v1/tx mint path must not silently produce "valid" fixtures.
    // Portfolio / balance reads remain unavailable (AccountState decode), so
    // we still record seededBalance as null — UI specs settle on the
    // unavailable banner, not on a fabricated funded list.
    let mintedAddress = '';
    if (FAUCET_CALLS > 0) {
      for (let i = 0; i < FAUCET_CALLS; i++) {
        const name = multiAsset ? undefined : i === 0 ? 'E2E-FIXTURE' : `E2E-FIXTURE-${i + 1}`;
        mintedAddress = await createCoinWithRetry(
          alice.mnemonic.join(' '),
          name !== undefined ? { name } : {},
        );
      }
      if (mintedAddress && alice.address && mintedAddress !== alice.address) {
        throw new Error(
          `globalSetup: v1-derived mint owner (${mintedAddress}) != wallet UI address ` +
            `(${alice.address}). The app and the e2e helper derive the wallet address differently.`,
        );
      }
    }
    const seededBalance = await noteFundingUnavailable(mintedAddress || alice.address);

    // Bob: fresh wallet, NO seeding.
    const bobCtx = await browser.newContext({ baseURL });
    applyColdStartTimeouts(bobCtx);
    const bob = await withPageRetry(bobCtx, 'create Bob wallet', async (page) => {
      await clearWalletState(page);
      const preset = process.env.E2E_BOB_MNEMONIC?.trim().split(/\s+/);
      if (preset && preset.length === 12) {
        return { ...(await restoreSeedWallet(page, preset, DEFAULT_PASSWORD)), mnemonic: preset };
      }
      return await createSeedWallet(page, DEFAULT_PASSWORD);
    });
    await bobCtx.close();

    const accounts: Accounts = {
      alice: { ...alice, seededBalance: seededBalance ?? undefined },
      bob,
    };

    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    fs.writeFileSync(FIXTURES_PATH, JSON.stringify(accounts, null, 2));
  } finally {
    await browser.close();
  }
}
