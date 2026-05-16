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
const outDir = path.join(repoRoot, 'public', 'handbook', 'screenshots');

const SUFFIX = '-chromium-linux.png';

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
}

main();
