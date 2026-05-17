/**
 * Fixture access: read the Alice + Bob accounts that `_global-setup.ts`
 * persisted to `e2e/.fixtures/accounts.json`, and provide one-call
 * helpers that log a Page in as either account via the restore flow.
 *
 * `aliceLogin(page)` and `bobLogin(page)` are the only entry points
 * tests should call. They:
 *   1. Wipe IDB + localStorage on the test's page (per-context).
 *   2. Drive `restoreSeedWallet` with the fixture's mnemonic.
 *
 * Per-context isolation: every Playwright test runs in its own browser
 * context, which has its own IndexedDB. Logging Alice in for one test
 * does not affect any other test running in parallel.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import {
  clearWalletState,
  DEFAULT_PASSWORD,
  restoreSeedWallet,
  waitForNetworkInfo,
} from './wallet';

export interface Account {
  mnemonic: string[];
  address: string;
  /** Sats observed after the post-mint balance poll. Only set for Alice. */
  seededBalance?: number;
}

export interface Accounts {
  alice: Account;
  bob: Account;
}

const FIXTURES_PATH = path.join(__dirname, '..', '.fixtures', 'accounts.json');

/**
 * Read the fixture file globalSetup wrote. Throws if absent — that means
 * globalSetup didn't run, which is a configuration error, not a test bug.
 */
export function readAccounts(): Accounts {
  if (!fs.existsSync(FIXTURES_PATH)) {
    throw new Error(
      `Fixture file missing: ${FIXTURES_PATH}. ` +
        `Did playwright.config.ts forget to wire globalSetup?`,
    );
  }
  const raw = fs.readFileSync(FIXTURES_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as Accounts;
  if (!parsed.alice?.mnemonic?.length || !parsed.bob?.mnemonic?.length) {
    throw new Error(`Fixture file at ${FIXTURES_PATH} is malformed: ${raw.slice(0, 200)}`);
  }
  return parsed;
}

/** Wipe state, then restore Alice via the UI. */
export async function aliceLogin(
  page: Page,
  password: string = DEFAULT_PASSWORD,
): Promise<Account> {
  const { alice } = readAccounts();
  await clearWalletState(page);
  await restoreSeedWallet(page, alice.mnemonic, password);
  // Block on the WalletScreen `api.info` roundtrip so any subsequent
  // navigation to /settings (or other routes that gate UI on the network
  // store) is race-free. See `waitForNetworkInfo` for the rationale.
  await waitForNetworkInfo(page);
  return alice;
}

/** Wipe state, then restore Bob via the UI. */
export async function bobLogin(page: Page, password: string = DEFAULT_PASSWORD): Promise<Account> {
  const { bob } = readAccounts();
  await clearWalletState(page);
  await restoreSeedWallet(page, bob.mnemonic, password);
  await waitForNetworkInfo(page);
  return bob;
}
