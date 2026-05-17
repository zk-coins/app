#!/usr/bin/env node
/**
 * Sync E2E visual baselines into public/handbook/screenshots/ at build/dev
 * time so the static handbook (public/handbook/index.html) can reference
 * them under the URL /handbook/screenshots/<name>.png.
 *
 * The canonical baselines live under e2e/<spec>.spec.ts-snapshots/. They
 * are the single source of truth — this script hardlinks (or copies, if
 * hardlink is unavailable) the chromium-linux variant into the public/
 * tree with a cleaner filename. The destination is gitignored so the
 * sync produces no diff noise.
 *
 * Wired into `predev` and `prebuild` so every local + CI run has the
 * latest baselines available to the handbook.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const e2eDir = path.join(repoRoot, 'e2e');
const handbookDir = path.join(repoRoot, 'public', 'handbook');
const outDir = path.join(handbookDir, 'screenshots');
const handbookFiles = [
  path.join(handbookDir, 'index.html'),
  path.join(handbookDir, 'de', 'index.html'),
];

const SUFFIX = '-chromium-linux.png';
const REF_RE = /\/handbook\/screenshots\/([^"'\s)]+\.png)/g;

function findBaselines() {
  const entries = fs.readdirSync(e2eDir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.endsWith('.spec.ts-snapshots')) continue;
    const dir = path.join(e2eDir, entry.name);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(SUFFIX)) continue;
      const clean = file.slice(0, -SUFFIX.length) + '.png';
      out.push({ src: path.join(dir, file), dest: path.join(outDir, clean) });
    }
  }
  return out;
}

function place(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // Replace whatever's there so re-runs always reflect the current source.
  try {
    fs.unlinkSync(dest);
  } catch {
    /* not present, fine */
  }
  try {
    fs.linkSync(src, dest);
  } catch {
    // Cross-device link or platform without hardlink support — fall back to copy.
    fs.copyFileSync(src, dest);
  }
}

function collectHandbookRefs() {
  // name -> sorted list of handbook files that reference it
  const refs = new Map();
  for (const file of handbookFiles) {
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    const rel = path.relative(repoRoot, file);
    for (const m of html.matchAll(REF_RE)) {
      const name = m[1];
      if (!refs.has(name)) refs.set(name, new Set());
      refs.get(name).add(rel);
    }
  }
  return refs;
}

function verifyCoverage(syncedNames) {
  const refs = collectHandbookRefs();
  const referenced = new Set(refs.keys());
  const synced = new Set(syncedNames);
  const dangling = [...referenced].filter((n) => !synced.has(n)).sort();
  const orphans = [...synced].filter((n) => !referenced.has(n)).sort();

  if (dangling.length === 0 && orphans.length === 0) return;

  console.error('sync-handbook-baselines: handbook ↔ baseline mismatch');
  if (dangling.length) {
    console.error('  Referenced in handbook but missing in e2e snapshots:');
    for (const n of dangling) {
      console.error(`    ${n}  (in ${[...refs.get(n)].sort().join(', ')})`);
    }
  }
  if (orphans.length) {
    console.error('  Present in e2e snapshots but not referenced in any handbook:');
    for (const n of orphans) {
      console.error(`    ${n}`);
    }
  }
  process.exit(1);
}

function main() {
  const baselines = findBaselines();
  if (baselines.length === 0) {
    console.error('sync-handbook-baselines: no *-chromium-linux.png files found under e2e/');
    process.exit(1);
  }
  for (const { src, dest } of baselines) place(src, dest);
  console.log(
    `sync-handbook-baselines: linked ${baselines.length} baseline(s) into public/handbook/screenshots/`,
  );
  verifyCoverage(baselines.map(({ dest }) => path.basename(dest)));
}

main();
