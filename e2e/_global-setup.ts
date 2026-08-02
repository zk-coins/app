/**
 * Runs once before any Playwright worker starts.
 *
 * Mints two fresh wallets (Alice + Bob) by driving the same Create flow
 * the user would. Alice is then seeded by creating her OWN asset via the
 * neutral multi-asset create-coin flow (creator-signed mint: admit
 * POST /v1/jobs/mint → commit → poll to completed, configurable via
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
import { isReMintRejection } from './_helpers/remint';
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

/** Run the creator-signed create-coin flow for `mnemonic`'s wallet, with a
 *  small retry on transient admit/proof failures. Without `opts.name` each
 *  call mints a fresh, uniquely-named asset (the helper auto-generates the
 *  name); the single-asset leg passes a deterministic fixture name instead
 *  so re-runs produce identical metadata. Returns the wallet's Poseidon
 *  owner address — the one the node credits and the one the balance poll
 *  must query. */
async function createCoinWithRetry(
  mnemonic: string,
  opts: { name?: string } = {},
  attempt = 1,
): Promise<string> {
  const maxAttempts = 3;
  try {
    const { address } = await api.createCoin(mnemonic, opts);
    return address;
  } catch (err) {
    // Idempotency guard (deterministic `opts.name` only): a PREVIOUS attempt
    // may have minted successfully server-side while this client's
    // completed-poll blipped (a single fetch error, or the 240 s poll
    // timeout). Re-admitting the same name then makes the node
    // deterministically reject the duplicate ("Re-mint into an existing
    // asset account is not supported", node/src/account_node.rs) — so on
    // attempt >= 2 that rejection is evidence the seed already landed:
    // return the wallet address and fall through to the caller's balance
    // poll, which verifies the funding independently. On attempt 1 the
    // rejection is a genuine collision and must stay fatal. Auto-generated
    // names regenerate per attempt and never take this path.
    // Re-mint rejection is NOT independent proof the fixture funded:
    // portfolio/balance reads are unavailable in this build, so we cannot
    // verify funding. Surface the error instead of pretending success.
    if (attempt > 1 && opts.name !== undefined && isReMintRejection(err)) {
      throw new Error(
        `globalSetup: create-coin for "${opts.name}" hit re-mint rejection on attempt ${attempt}, ` +
          `but no independent funding verification is available (read path not wired). ` +
          `Original error: ${String(err)}`,
      );
    }
    if (attempt >= maxAttempts) throw err;
    const wait = 1_000 * 2 ** (attempt - 1);
    console.warn(
      `globalSetup: create-coin failed (attempt ${attempt}/${maxAttempts}), retrying in ${wait}ms`,
    );
    await new Promise((r) => setTimeout(r, wait));
    return createCoinWithRetry(mnemonic, opts, attempt + 1);
  }
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
        `Point at a testnet (signet) API or run a smoke spec instead.`,
    );
  }

  // Branch the seeding strategy on the REPORTED multi-asset capability.
  // The E2E api helper hits E2E_API_URL (the info-proxy in CI, which
  // normalises `multi_asset` to false and passes /v1/jobs/* through 1:1).
  // Either way the seed itself is the creator-signed create-coin flow —
  // the node's neutral permissionless model has no server-mediated faucet,
  // so a wallet is funded by minting an asset it owns. The branches differ
  // only in surface semantics:
  //   - false → single-asset UI mode: mint ONE deterministic fixture asset
  //     and confirm funding via the same single-asset balance read the UI
  //     performs (proxy-translated, see `_helpers/api.ts::walletBalance`).
  //   - true  → multi-asset UI mode: mint uniquely-named assets and confirm
  //     funding via the per-owner portfolio.
  const multiAsset = info.capabilities?.multi_asset === true;

  const browser = await chromium.launch();
  try {
    // Alice: fresh wallet, then seed via the creator-signed
    // /v1/jobs/mint (admit → commit → completed) × FAUCET_CALLS.
    const aliceCtx = await browser.newContext({ baseURL });
    applyColdStartTimeouts(aliceCtx);
    const alice = await withPageRetry(aliceCtx, 'create Alice wallet', async (page) => {
      await clearWalletState(page);
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
      return await createSeedWallet(page, DEFAULT_PASSWORD);
    });
    await bobCtx.close();

    const accounts: Accounts = {
      alice: { ...alice, seededBalance: seededBalance ?? undefined },
      bob,
    };

    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    fs.writeFileSync(FIXTURES_PATH, JSON.stringify(accounts, null, 2));

    console.log(
      `globalSetup: Alice ${alice.address} (balance not available in this build)  Bob ${bob.address}`,
    );
  } finally {
    await browser.close();
  }
}
