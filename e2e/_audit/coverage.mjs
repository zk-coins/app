#!/usr/bin/env node
/**
 * Button-Inventory-Audit: every interactive element in src/ should have a
 * data-testid (or testid prop on a Card-style wrapper) AND be referenced
 * by an e2e spec. This script reports the gap.
 *
 * Internally the audit collects three groups of findings:
 *   A. testids defined in src/ that no e2e spec touches.
 *   B. testids referenced in e2e/ that don't appear in src/ -- usually
 *      template-literal ids; resolved prefixes are tracked so true ghosts
 *      stand out.
 *   C. <button>/onClick handlers in src/ with no testid and no aria-label.
 *
 * Output policy:
 *   - On pass ([OK]): a one-paragraph "all clear" summary. No per-section
 *     lists, no exempt-noise -- exempt entries are an implementation detail
 *     of this script, not a reviewer's problem.
 *   - On fail ([FAIL]): only the actionable findings (non-exempt A/C plus
 *     ghost B entries), so the PR comment lists exactly what to fix.
 *
 * Exit codes:
 *   0 -- no uncovered MVP testids and no fully unlabeled MVP buttons.
 *   1 -- at least one section A finding outside MVP_EXEMPT_TESTIDS, or one
 *       section C finding outside MVP_EXEMPT_FILES / MVP_EXEMPT_BUTTON_SNIPPETS.
 *
 * Output respects --markdown (sticky PR comment format) and --json. The
 * --json mode always emits all three sections so tooling/debugging keeps
 * access to the full picture.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const srcDir = path.join(repoRoot, 'src');
const e2eDir = path.join(repoRoot, 'e2e');

// MVP scope: src/lib/features.ts FEATURES.PASSKEY etc. are dead-stripped
// from the PRD bundle. We don't require e2e coverage for those testids.
const MVP_EXEMPT_TESTIDS = new Set([
  'passkey-restore-btn',
  'unlock-passkey-btn',
  // FEATURES.USERNAMES gated — dead-stripped from PRD bundle.
  'username-claim-btn',
  // Disabled loading states are visually transient -- Playwright cannot
  // reliably catch them without artificially slowing WASM calls.
  'seed-creating-btn',
  'seed-import-restoring-btn',
]);

// Generic wrapper components are allowed to expose <button> without testid
// because the testid lives on the wrapper's usage site.
const MVP_EXEMPT_FILES = new Set([
  'src/components/PwaPrompt.tsx', // shared Dismiss-X across PWA variants
  'src/app/settings/page.tsx', // generic Toggle component
]);

// Buttons sitting inside a `{FEATURES.X && (...)}` JSX block are dead-
// stripped from the PRD bundle by Next.js DCE when the corresponding
// NEXT_PUBLIC_ENABLE_* flag is off, and are therefore out of MVP scope.
// Pinned by the snippet substring (not line number) so the allowlist
// survives unrelated reflows of the surrounding code.
const MVP_EXEMPT_BUTTON_SNIPPETS = [
  // PasskeyFlow register button — FEATURES.PASSKEY gated, dead-stripped from PRD bundle.
  { file: 'src/components/onboarding/Onboarding.tsx', snippet: 'onClick={register}' },
  // PasskeyRestoreFlow authenticate button — FEATURES.PASSKEY gated, dead-stripped from PRD bundle.
  // Pinned to the unique button label rather than `onClick={restore}`, which also appears on the
  // SeedImport submit button (that one has its own `seed-import-submit-btn` testid).
  { file: 'src/components/onboarding/Onboarding.tsx', snippet: 'Authenticate with passkey' },
];

const args = new Set(process.argv.slice(2));
const FORMAT_MARKDOWN = args.has('--markdown');
const FORMAT_JSON = args.has('--json');
const REPORT_ONLY = args.has('--report-only');

function walk(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...walk(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function rel(file) {
  return path.relative(repoRoot, file);
}

// --- Section A + B: testid universe ---------------------------------------

const SRC_LITERAL_RE = /(?:data-)?testid=["']([a-z0-9-]+)["']/g;
// Capture the full template content; the variable parts ${...} become wildcards.
const SRC_TEMPLATE_RE = /(?:data-)?testid=\{`([^`]+)`\}/g;
const E2E_GETBY_RE = /getByTestId\(['"]([a-z0-9-]+)['"]\)/g;
const E2E_LOCATOR_RE = /\[data-testid=["']([a-z0-9-]+)["']\]/g;
const E2E_STRING_RE = /['"]([a-z][a-z0-9-]{3,})['"]/g; // fallback: any quoted token

const srcLiteralIds = new Map(); // id -> [{file, line}]
const srcTemplatePatterns = []; // [{pattern: 'wallet-${x}-btn', regex: /^wallet-[^-]+-btn$/}]

function templateToRegex(template) {
  // Escape regex metachars except ${...}; replace each ${...} with [^-]+
  const PLACEHOLDER = '__VAR__';
  const masked = template.replace(/\$\{[^}]+\}/g, PLACEHOLDER);
  const escaped = masked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replaceAll(PLACEHOLDER, '[^-]+');
  return new RegExp('^' + pattern + '$');
}

for (const file of walk(srcDir, ['.ts', '.tsx'])) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const m of line.matchAll(SRC_LITERAL_RE)) {
      const id = m[1];
      if (!srcLiteralIds.has(id)) srcLiteralIds.set(id, []);
      srcLiteralIds.get(id).push({ file: rel(file), line: i + 1 });
    }
    for (const m of line.matchAll(SRC_TEMPLATE_RE)) {
      const template = m[1];
      srcTemplatePatterns.push({ template, regex: templateToRegex(template) });
    }
  }
}

const e2eIds = new Set();
const e2eStrings = new Set();
for (const file of walk(e2eDir, ['.ts', '.tsx', '.mjs'])) {
  const content = fs.readFileSync(file, 'utf8');
  for (const m of content.matchAll(E2E_GETBY_RE)) e2eIds.add(m[1]);
  for (const m of content.matchAll(E2E_LOCATOR_RE)) e2eIds.add(m[1]);
  for (const m of content.matchAll(E2E_STRING_RE)) e2eStrings.add(m[1]);
}

function isCoveredInE2e(id) {
  if (e2eIds.has(id)) return true;
  // also accept literal-string references (mask lists, comments naming the id)
  if (e2eStrings.has(id)) return true;
  return false;
}

function matchesTemplatePrefix(id) {
  for (const { template, regex } of srcTemplatePatterns) {
    if (regex.test(id)) return template;
  }
  return null;
}

const sectionA = []; // uncovered testids in src
for (const [id, locs] of srcLiteralIds) {
  if (!isCoveredInE2e(id)) {
    sectionA.push({ id, locs, exempt: MVP_EXEMPT_TESTIDS.has(id) });
  }
}
sectionA.sort((a, b) => Number(a.exempt) - Number(b.exempt) || a.id.localeCompare(b.id));

const sectionB = []; // testids referenced in e2e but not literal in src
for (const id of e2eIds) {
  if (srcLiteralIds.has(id)) continue;
  const prefix = matchesTemplatePrefix(id);
  sectionB.push({ id, resolvedFrom: prefix });
}
sectionB.sort((a, b) => a.id.localeCompare(b.id));

// --- Section C: buttons without testid ------------------------------------

const sectionC = [];
const BTN_RE = /<button\b|onClick=\{/;

for (const file of walk(srcDir, ['.tsx'])) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!BTN_RE.test(lines[i])) continue;
    // Narrow window (+/-4) for the testid/aria-label proximity check.
    const fromNarrow = Math.max(0, i - 4);
    const toNarrow = Math.min(lines.length, i + 6);
    const narrowWindow = lines.slice(fromNarrow, toNarrow).join('\n');
    if (/(data-)?testid=/.test(narrowWindow)) continue;
    if (/aria-label=/.test(narrowWindow)) continue;
    // Wider window (+/-12) for the feature-gated-exempt snippet match.
    // A `{FEATURES.X && (...)}` block can wrap a button several lines
    // away from its identifying call (e.g. `api.claimUsername`).
    const fromWide = Math.max(0, i - 12);
    const toWide = Math.min(lines.length, i + 18);
    const wideWindow = lines.slice(fromWide, toWide).join('\n');
    sectionC.push({
      file: rel(file),
      line: i + 1,
      snippet: lines[i].trim(),
      window: wideWindow,
    });
  }
}

// --- failure determination -------------------------------------------------

function isFeatureGatedExempt(entry) {
  return MVP_EXEMPT_BUTTON_SNIPPETS.some(
    ({ file, snippet }) => entry.file === file && entry.window.includes(snippet),
  );
}

const fails = {
  uncoveredTestids: sectionA.filter((e) => !e.exempt),
  unlabeledButtons: sectionC.filter(
    (e) => !MVP_EXEMPT_FILES.has(e.file) && !isFeatureGatedExempt(e),
  ),
};

const passed = fails.uncoveredTestids.length === 0 && fails.unlabeledButtons.length === 0;

// --- output ---------------------------------------------------------------

const exitCode = passed || REPORT_ONLY ? 0 : 1;

if (FORMAT_JSON) {
  console.log(JSON.stringify({ sectionA, sectionB, sectionC, passed }, null, 2));
  process.exit(exitCode);
}

const lines = [];
const h = FORMAT_MARKDOWN ? '## ' : '=== ';
const sub = FORMAT_MARKDOWN ? '### ' : '--- ';

if (passed) {
  // Short success message — no per-section lists, no exempt-noise.
  if (FORMAT_MARKDOWN) {
    lines.push('<!-- audit:button-coverage -->');
    lines.push('# [OK] Button-Inventory-Audit — all clear');
    lines.push('');
    lines.push(
      `Checked ${srcLiteralIds.size} testid(s) in \`src/\` against ${e2eIds.size} reference(s) in \`e2e/\`. Nothing to do.`,
    );
  } else {
    lines.push('[OK] Button-Inventory-Audit — all clear');
    lines.push(
      `Checked ${srcLiteralIds.size} src testid(s) against ${e2eIds.size} e2e reference(s).`,
    );
  }
  console.log(lines.join('\n'));
  process.exit(exitCode);
}

// Failure path: show only the actionable findings (no exempt entries).
lines.push(
  `${FORMAT_MARKDOWN ? '<!-- audit:button-coverage -->\n# ' : ''}[FAIL] Button-Inventory-Audit`,
);
lines.push('');
lines.push(
  `src/ testids: ${srcLiteralIds.size} literal + ${srcTemplatePatterns.length} template-literal pattern(s)`,
);
lines.push(`e2e/ testids referenced: ${e2eIds.size}`);
lines.push('');

if (fails.uncoveredTestids.length > 0) {
  lines.push(`${h}testids in src/ not referenced in e2e/`);
  for (const { id, locs } of fails.uncoveredTestids) {
    const loc = locs[0];
    lines.push(`- \`${id}\` -- \`${loc.file}:${loc.line}\``);
  }
  lines.push('');
}

const ghosts = sectionB.filter((e) => !e.resolvedFrom);
if (ghosts.length > 0) {
  lines.push(`${h}ghost testids in e2e/ (no matching src literal or template)`);
  for (const { id } of ghosts) {
    lines.push(`- \`${id}\` -- broken selector?`);
  }
  lines.push('');
}

if (fails.unlabeledButtons.length > 0) {
  lines.push(`${h}<button>/onClick without testid or aria-label`);
  for (const { file, line, snippet } of fails.unlabeledButtons) {
    lines.push(`- \`${file}:${line}\` -- \`${snippet.slice(0, 80)}\``);
  }
  lines.push('');
}

lines.push(`${sub}Summary`);
lines.push(`- ${fails.uncoveredTestids.length} uncovered MVP testid(s)`);
lines.push(`- ${fails.unlabeledButtons.length} unlabeled MVP button(s)`);
lines.push('');
lines.push(
  'Add a `getByTestId(...)` assertion in the relevant spec, or -- if intentionally out-of-scope -- add the id to `MVP_EXEMPT_TESTIDS` / file to `MVP_EXEMPT_FILES` in `e2e/_audit/coverage.mjs` with a one-line justification.',
);
if (REPORT_ONLY) {
  lines.push('');
  lines.push(
    '_Running in `--report-only` mode: findings are reported but the check passes. Switch to `--strict` once the backlog is cleared._',
  );
}

console.log(lines.join('\n'));
process.exit(exitCode);
