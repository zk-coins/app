/**
 * Guard: no production module may still reference legacy `/api/` node paths.
 * The closed public surface is `/v1/*` only (spec §7.5).
 *
 * Implementation is filesystem-grep based (same spirit as existing
 * convention tests) — a unit-test over the client configuration would not
 * catch a stray fetch in a screen.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '../../..');

/** Paths that are allowed to mention `/api/` as documentation of what was removed. */
const ALLOWLIST_SUBSTRINGS = [
  // This file itself.
  'no-legacy-api-paths.test.ts',
  // Comments documenting the migration away from /api/.
  'client.ts',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '__tests__') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe('no legacy /api/ node paths', () => {
  it('production src has no `/api/` path literals for node traffic', () => {
    const files = walk(SRC_ROOT);
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (ALLOWLIST_SUBSTRINGS.some((a) => rel.endsWith(a) || rel.includes(`/${a}`))) {
        // client.ts may still mention /api/ in comments about what was removed;
        // assert it has no live path string used as a fetch target.
        if (rel.endsWith('client.ts')) {
          const text = readFileSync(file, 'utf8');
          // Disallow quoted `/api/...` path fragments that look like fetch targets.
          const live = text.match(/['"`]\/api\/[^'"`]+['"`]/g) ?? [];
          if (live.length > 0) {
            offenders.push(`${rel}: ${live.join(', ')}`);
          }
        }
        continue;
      }
      const text = readFileSync(file, 'utf8');
      if (/['"`]\/api\//.test(text) || /\$\{[^}]*\}\/api\//.test(text)) {
        offenders.push(rel);
      }
    }

    expect(offenders, `legacy /api/ references:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('api client factory only dials /v1/ routes via ZkCoinsV1Client', async () => {
    // Structural: the module must export the v1-shaped api and must not
    // re-export a legacy ZkCoinsClient constructor.
    const mod = await import('@/lib/api/client');
    expect(mod.api).toBeDefined();
    expect(typeof mod.api.info).toBe('function');
    expect(typeof mod.api.send).toBe('function');
    expect(typeof mod.api.placeDeliveryAt).toBe('function');
    // No legacy sendJob / commitJob surface.
    expect((mod.api as Record<string, unknown>).sendJob).toBeUndefined();
    expect((mod.api as Record<string, unknown>).commitJob).toBeUndefined();
  });
});
