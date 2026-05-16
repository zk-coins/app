/**
 * Runs once after all workers finish. Unlinks the fixture file unless
 * E2E_KEEP_ACCOUNTS is set (useful when debugging a flaky run — you can
 * inspect what mnemonics were used).
 *
 * On-chain Alice + Bob stay reachable; the server has no delete endpoint,
 * and they're random so they don't collide with future runs.
 *
 * Wired from `playwright.config.ts::globalTeardown`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const FIXTURES_PATH = path.join(__dirname, '.fixtures', 'accounts.json');

export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_ACCOUNTS === 'true') {
    console.log(`globalTeardown: keeping ${FIXTURES_PATH} (E2E_KEEP_ACCOUNTS=true)`);
    return;
  }
  if (fs.existsSync(FIXTURES_PATH)) {
    fs.unlinkSync(FIXTURES_PATH);
  }
}
