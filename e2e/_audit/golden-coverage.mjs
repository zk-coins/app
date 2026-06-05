#!/usr/bin/env node
/**
 * Golden-Coverage-Audit: every active, ungated user-facing screen must
 * have a visual-regression golden tied to it. This catches the #166
 * failure mode — a screen (`/network`) shipping without a page-level
 * baseline — at CI time, before merge.
 *
 * A naive "does a `*network*.png` file exist?" check false-passes: spec
 * 09 emits `09-network-badge-*.png`, but those are shot on `/settings`,
 * not `/network`. So coverage is asserted against a declarative registry
 * (`screens.ts`) that pins each screen to its EXACT baseline name(s),
 * never a fuzzy filename match.
 *
 * Two source-of-truth layers:
 *   1. Route screens — auto-inventoried from `src/app/<seg>/page.tsx`, minus
 *      the env-gated routes (a route whose body is `!FEATURES.<flag>)
 *      notFound()` for a flag in the shared `ENV_GATED_FEATURES` set is
 *      dead-stripped from the shipped bundle and out of scope).
 *   2. State-driven `/` views (Onboarding / Unlock / Wallet) — not
 *      routes, so enumerated only by the registry.
 *
 * Fails (exit 1) when:
 *   (a) a non-gated `page.tsx` route is absent from the registry — the
 *       "won't happen again" guarantee: a new route without a registered
 *       golden breaks CI; or
 *   (b) a registered active screen's expected baseline file(s) are
 *       missing from the matching `e2e/*.spec.ts-snapshots/` directory;
 *   plus integrity failures: a stale registry entry (route gone), a bad
 *   `gate` value, or a registry gate that disagrees with the route's
 *   actual `notFound()` guard.
 *
 * Exit codes: 0 — all clear (or `--report-only`); 1 — at least one of the
 * failures above. Output respects `--markdown` (sticky PR comment) and
 * `--json`. Mirrors the conventions of the sibling `coverage.mjs`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_GATED_FEATURES, isEnvGatedFeature } from './gates.mjs';
import { SCREENS } from './screens.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const appDir = path.join(repoRoot, 'src', 'app');
const e2eDir = path.join(repoRoot, 'e2e');

const PLATFORM_SUFFIX = '-chromium-linux.png';

const args = new Set(process.argv.slice(2));
const FORMAT_MARKDOWN = args.has('--markdown');
const FORMAT_JSON = args.has('--json');
const REPORT_ONLY = args.has('--report-only');

// --- route auto-inventory --------------------------------------------------

/** Map `src/app/<segs>/page.tsx` → URL path, dropping `(group)` segments. */
function routeOf(pageFile) {
  const relDir = path.relative(appDir, path.dirname(pageFile));
  if (relDir === '') return '/';
  const segs = relDir.split(path.sep).filter((s) => !/^\(.*\)$/.test(s)); // route groups don't affect the URL
  return '/' + segs.join('/');
}

function findPageFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...findPageFiles(full));
    } else if (entry.name === 'page.tsx') {
      out.push(full);
    }
  }
  return out;
}

// Detect a build-time route gate: `!FEATURES.<FLAG>) notFound()`.
const GATE_GUARD_RE = /!\s*FEATURES\.([A-Z0-9_]+)\s*\)\s*notFound\s*\(\s*\)/g;

// Strip block + line comments before gate detection so a commented-out
// guard (`// if (!FEATURES.X) notFound()`) can't mark a live route as
// exempt. The `[^:]` lookbehind on the line-comment arm preserves `://`
// in URL string literals (e.g. `url: 'https://…'`), which never share a
// line with a real guard.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function detectGate(source) {
  let recognized = null;
  const unrecognized = [];
  for (const m of source.matchAll(GATE_GUARD_RE)) {
    const flag = m[1];
    if (isEnvGatedFeature(flag)) {
      if (!recognized) recognized = flag;
    } else if (!unrecognized.includes(flag)) {
      unrecognized.push(flag);
    }
  }
  return { recognized, unrecognized };
}

const routes = findPageFiles(appDir)
  .map((file) => {
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    const { recognized, unrecognized } = detectGate(source);
    return {
      route: routeOf(file),
      file: path.relative(repoRoot, file),
      gatedBy: recognized, // env-gated flag, or null
      unrecognizedGates: unrecognized, // gated by a non-exempt flag → still active
    };
  })
  .sort((a, b) => a.route.localeCompare(b.route));

const routeByPath = new Map(routes.map((r) => [r.route, r]));

// --- registry indexing -----------------------------------------------------

const routeScreens = new Map(); // path -> screen
const screensReachingRoute = new Map(); // route -> [screen] (route + state both)
for (const s of SCREENS) {
  const reachRoute = s.reach.kind === 'route' ? s.reach.path : s.reach.route;
  if (!screensReachingRoute.has(reachRoute)) screensReachingRoute.set(reachRoute, []);
  screensReachingRoute.get(reachRoute).push(s);
  if (s.reach.kind === 'route') routeScreens.set(s.reach.path, s);
}

function baselineFile(b) {
  return path.join(e2eDir, `${b.spec}.spec.ts-snapshots`, `${b.name}${PLATFORM_SUFFIX}`);
}

// --- checks ----------------------------------------------------------------

const findings = {
  uncoveredRoutes: [], // (a) active route, no registry entry
  missingBaselines: [], // (b) registered baseline file absent
  emptyActiveScreens: [], // active screen with zero declared baselines
  staleScreens: [], // registry entry for a route that no longer exists
  gateProblems: [], // bad/inconsistent gate declarations
};

const exemptRoutes = []; // {route, gate}
const activeScreenRows = []; // for the report table

// (a) every active (non-gated) route must be reachable from the registry.
for (const r of routes) {
  if (r.gatedBy) {
    exemptRoutes.push({ route: r.route, gate: r.gatedBy });
    // If the registry also lists this route, its gate must match the source.
    const reg = routeScreens.get(r.route);
    if (reg && reg.gate !== r.gatedBy) {
      findings.gateProblems.push(
        `\`${r.route}\` is \`!FEATURES.${r.gatedBy}) notFound()\` in source, but the registry ` +
          (reg.gate ? `declares gate \`${reg.gate}\`` : 'declares no gate'),
      );
    }
    continue;
  }
  const reachers = screensReachingRoute.get(r.route);
  if (!reachers || reachers.length === 0) {
    findings.uncoveredRoutes.push(r);
  }
}

// registry integrity + (b) baseline existence.
for (const s of SCREENS) {
  const reachRoute = s.reach.kind === 'route' ? s.reach.path : s.reach.route;

  // stale entry: the route it points at no longer has a page.tsx.
  if (!routeByPath.has(reachRoute)) {
    findings.staleScreens.push({ id: s.id, reachRoute });
  }

  if (s.gate !== undefined) {
    if (!isEnvGatedFeature(s.gate)) {
      findings.gateProblems.push(
        `screen \`${s.id}\` declares unknown gate \`${s.gate}\` (not in ENV_GATED_FEATURES)`,
      );
    }
    // Reverse gate check: a registry `gate` MUST be backed by an actual
    // `!FEATURES.<gate>) notFound()` guard in the route's source. Without
    // this, mislabelling a live screen (e.g. `/send`) as gated would skip
    // its baseline check below and pass green while it ships with no
    // golden — the exact gap this audit exists to close.
    const src = routeByPath.get(reachRoute);
    if (src && src.gatedBy !== s.gate) {
      findings.gateProblems.push(
        `screen \`${s.id}\` declares gate \`${s.gate}\` but its route \`${reachRoute}\` ` +
          (src.gatedBy
            ? `is \`!FEATURES.${src.gatedBy}) notFound()\` in source`
            : 'is not env-gated in source (the route is active and needs a golden)'),
      );
    }
    if (s.baselines.length > 0) {
      findings.gateProblems.push(
        `screen \`${s.id}\` is gated (\`${s.gate}\`) but still declares ${s.baselines.length} baseline(s)`,
      );
    }
    continue; // gated screens carry no golden by design
  }

  // active screen: must declare ≥1 baseline, and each must exist.
  if (s.baselines.length === 0) {
    findings.emptyActiveScreens.push(s.id);
    activeScreenRows.push({ s, present: [], missing: ['(none declared)'] });
    continue;
  }
  const present = [];
  const missing = [];
  for (const b of s.baselines) {
    if (fs.existsSync(baselineFile(b))) present.push(b);
    else {
      missing.push(b);
      findings.missingBaselines.push({ id: s.id, baseline: b });
    }
  }
  activeScreenRows.push({ s, present, missing });
}

const failCount =
  findings.uncoveredRoutes.length +
  findings.missingBaselines.length +
  findings.emptyActiveScreens.length +
  findings.staleScreens.length +
  findings.gateProblems.length;
const passed = failCount === 0;
const exitCode = passed || REPORT_ONLY ? 0 : 1;

// --- output ----------------------------------------------------------------

if (FORMAT_JSON) {
  console.log(
    JSON.stringify(
      {
        routes,
        envGatedFeatures: ENV_GATED_FEATURES,
        findings,
        activeScreens: activeScreenRows.map(({ s, present, missing }) => ({
          id: s.id,
          title: s.title,
          reach: s.reach,
          present: present.map((b) => b.name),
          missing: missing.map((b) => (typeof b === 'string' ? b : b.name)),
        })),
        passed,
      },
      null,
      2,
    ),
  );
  process.exit(exitCode);
}

const out = [];
const h = FORMAT_MARKDOWN ? '## ' : '--- ';
const reach = (s) =>
  s.reach.kind === 'route' ? `\`${s.reach.path}\`` : `\`${s.reach.route}\` · ${s.reach.state}`;

function coverageTable() {
  if (!FORMAT_MARKDOWN) {
    const rows = activeScreenRows.map(
      ({ s, missing }) => `  ${missing.length === 0 ? '[ok]' : '[--]'} ${s.id} (${s.title})`,
    );
    return rows.join('\n');
  }
  const rows = ['| Screen | Reach | Golden(s) | Status |', '| --- | --- | --- | --- |'];
  for (const { s, present, missing } of activeScreenRows) {
    const names = [...present, ...missing.filter((m) => typeof m !== 'string')]
      .map((b) => `\`${b.name}\``)
      .join(', ');
    const status = missing.length === 0 ? '✅' : `❌ missing ${missing.length}`;
    rows.push(`| ${s.id} | ${reach(s)} | ${names || '—'} | ${status} |`);
  }
  for (const { route, gate } of exemptRoutes) {
    rows.push(`| _(gated)_ | \`${route}\` | — | ⚪ exempt (\`${gate}\`) |`);
  }
  return rows.join('\n');
}

if (passed) {
  if (FORMAT_MARKDOWN) {
    out.push('<!-- audit:golden-coverage -->');
    out.push('# [OK] Golden-Coverage-Audit — all clear');
    out.push('');
    out.push(
      `Every active, ungated screen has its golden: ${activeScreenRows.length} active screen(s) across ${routes.length} route(s), ${exemptRoutes.length} env-gated route(s) exempt.`,
    );
    out.push('');
    out.push(coverageTable());
  } else {
    out.push('[OK] Golden-Coverage-Audit — all clear');
    out.push(
      `${activeScreenRows.length} active screen(s), ${exemptRoutes.length} gated route(s) exempt.`,
    );
    out.push(coverageTable());
  }
  console.log(out.join('\n'));
  process.exit(exitCode);
}

// failure path
out.push(
  `${FORMAT_MARKDOWN ? '<!-- audit:golden-coverage -->\n# ' : ''}[FAIL] Golden-Coverage-Audit`,
);
out.push('');

if (findings.uncoveredRoutes.length > 0) {
  out.push(`${h}active route(s) with no registered screen`);
  for (const r of findings.uncoveredRoutes) {
    const extra = r.unrecognizedGates.length
      ? ` (gated by non-exempt flag(s): ${r.unrecognizedGates.join(', ')} — add a golden, or promote the flag in gates.mjs)`
      : '';
    out.push(`- \`${r.route}\` — \`${r.file}\`${extra}`);
  }
  out.push('');
}

if (findings.missingBaselines.length > 0) {
  out.push(`${h}registered baseline(s) missing from snapshots`);
  for (const { id, baseline } of findings.missingBaselines) {
    out.push(
      `- \`${id}\` → \`e2e/${baseline.spec}.spec.ts-snapshots/${baseline.name}${PLATFORM_SUFFIX}\``,
    );
  }
  out.push('');
}

if (findings.emptyActiveScreens.length > 0) {
  out.push(`${h}active screen(s) declaring no baseline`);
  for (const id of findings.emptyActiveScreens) out.push(`- \`${id}\``);
  out.push('');
}

if (findings.staleScreens.length > 0) {
  out.push(`${h}stale registry entr(ies) (route no longer exists)`);
  for (const { id, reachRoute } of findings.staleScreens)
    out.push(`- \`${id}\` → \`${reachRoute}\``);
  out.push('');
}

if (findings.gateProblems.length > 0) {
  out.push(`${h}gate inconsistenc(ies)`);
  for (const msg of findings.gateProblems) out.push(`- ${msg}`);
  out.push('');
}

out.push(`${FORMAT_MARKDOWN ? '### ' : '--- '}Coverage`);
out.push(coverageTable());
out.push('');
out.push(
  'Register the screen in `e2e/_audit/screens.ts` with its expected baseline name(s), add the golden via the `regenerate-visual-baselines` workflow, or — if the route is intentionally env-gated — guard it with `!FEATURES.<flag>) notFound()` and add `<flag>` to `ENV_GATED_FEATURES` in `e2e/_audit/gates.mjs`.',
);
if (REPORT_ONLY) {
  out.push('');
  out.push('_Running in `--report-only` mode: findings reported but the check passes._');
}

console.log(out.join('\n'));
process.exit(exitCode);
