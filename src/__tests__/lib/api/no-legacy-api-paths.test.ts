/**
 * Guard: no executable module may still reference legacy `/api/` node paths.
 * The closed public surface is `/v1/*` only (spec §7.5).
 *
 * Scans from the repo root across src, e2e, scripts, and workflows —
 * filesystem-grep based so a stray fetch/route mock cannot hide.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '../../../..');

/** Relative paths (or suffixes) allowed to mention the legacy path as docs of removal. */
const ALLOWLIST_SUBSTRINGS = [
  // This file itself documents the forbidden pattern.
  'no-legacy-api-paths.test.ts',
];

/** Directories under the repo root to scan. */
const SCAN_ROOTS = ['src', 'e2e', 'scripts', '.github/workflows'];

/** File extensions treated as executable / config that may dial the node. */
const EXEC_EXT = /\.(ts|tsx|js|mjs|cjs|yaml|yml)$/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (
      name === 'node_modules' ||
      name === '.next' ||
      name === 'coverage' ||
      name === 'test-results' ||
      name === 'playwright-report' ||
      name === '.fixtures' ||
      name.endsWith('-snapshots')
    ) {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXEC_EXT.test(name)) out.push(full);
  }
  return out;
}

/** Quoted path fragments that look like live `/api/...` fetch or route targets. */
const LIVE_API_PATH = /['"`]\/api\/[^'"`\s]+['"`]/;

describe('no legacy /api/ node paths', () => {
  it('repo executables have no `/api/` path literals for node traffic', () => {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
      walk(join(REPO_ROOT, root), files);
    }
    // Also scan top-level config that rewrites or proxies.
    for (const name of [
      'next.config.js',
      'playwright.config.ts',
      'vitest.config.ts',
      'public/sw.js',
    ]) {
      const full = join(REPO_ROOT, name);
      try {
        if (statSync(full).isFile()) files.push(full);
      } catch {
        /* optional */
      }
    }

    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(REPO_ROOT, file);
      if (ALLOWLIST_SUBSTRINGS.some((a) => rel.endsWith(a) || rel.includes(`/${a}`))) {
        continue;
      }
      const text = readFileSync(file, 'utf8');
      const live = text.match(new RegExp(LIVE_API_PATH, 'g')) ?? [];
      if (live.length > 0) {
        offenders.push(`${rel}: ${live.join(', ')}`);
      }
      // Template-literal concatenations that still dial /api/.
      if (/\$\{[^}]*\}\/api\//.test(text)) {
        offenders.push(`${rel}: template …}/api/`);
      }
    }

    expect(offenders, `legacy /api/ references:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('api client factory only dials /v1/ routes via ZkCoinsV1Client', async () => {
    const mod = await import('@/lib/api/client');
    expect(mod.api).toBeDefined();
    expect(typeof mod.api.info).toBe('function');
    expect(typeof mod.api.send).toBe('function');
    expect(typeof mod.api.placeDeliveryAt).toBe('function');
    expect((mod.api as Record<string, unknown>).sendJob).toBeUndefined();
    expect((mod.api as Record<string, unknown>).commitJob).toBeUndefined();
  });

  it('api.send refuses empty input_coins (no /v1/tx with empty inputs)', async () => {
    const { api, ApiError } = await import('@/lib/api/client');
    const { useNetworkStore } = await import('@/stores/network');
    useNetworkStore.setState({
      apiUrl: 'https://test-api.zkcoins.app',
      network: 'regtest',
      infoError: null,
      infoLoaded: true,
    });
    await expect(
      api.send({
        account_address: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        recipient: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        amount: '1',
        asset_id: 'aa'.repeat(32),
        mnemonic:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        nkCommit: '00'.repeat(32),
        accountIndex: 0,
        delivery: {
          type: 'invoice',
          invoice: {
            amount: '1',
            recipient: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
            asset_id: 'aa'.repeat(32),
            pk0: 'bb'.repeat(32),
            nk_commit: 'cc'.repeat(32),
            ivpk: 'dd'.repeat(32),
            op_pubkey: 'ee'.repeat(32),
            relays: ['wss://r.example'],
            addr_sig: '11'.repeat(64),
            sig: '22'.repeat(64),
          },
        },
        input_coins: [],
      }),
    ).rejects.toMatchObject({ status: 501 });
    await expect(
      api.send({
        account_address: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        recipient: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        amount: '1',
        asset_id: 'aa'.repeat(32),
        mnemonic:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        nkCommit: '00'.repeat(32),
        accountIndex: 0,
        delivery: {
          type: 'invoice',
          invoice: {
            amount: '1',
            recipient: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
            asset_id: 'aa'.repeat(32),
            pk0: 'bb'.repeat(32),
            nk_commit: 'cc'.repeat(32),
            ivpk: 'dd'.repeat(32),
            op_pubkey: 'ee'.repeat(32),
            relays: ['wss://r.example'],
            addr_sig: '11'.repeat(64),
            sig: '22'.repeat(64),
          },
        },
        input_coins: [],
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
