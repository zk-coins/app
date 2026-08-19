/**
 * QR scan helpers — pure, render-free logic shared by the Send-screen
 * scanner (`src/components/QrScanModal.tsx`) and its tests.
 *
 * Two responsibilities, both kept out of the React component so they can
 * be unit-tested in isolation (and so the component stays render-only,
 * per the thin-client rule in CONTRIBUTING.md):
 *
 *   1. `decodeQr(...)` — turn a frame's pixel buffer into the QR's text
 *      payload via jsQR. The same primitive serves the live camera path
 *      (a `<canvas>` `getImageData` of each video frame) and the
 *      file-upload fallback (a `getImageData` of the decoded image).
 *
 *   2. `extractRecipient(...)` — normalise a raw QR payload into a
 *      recipient string the Send form accepts, or `null` when the
 *      payload is not a plausible zkCoins recipient. Identity rule:
 *      names and Invoice JSON only — never a raw `zk1…` or bare hex key.
 *
 * The Receive QR encodes the account name (`username@domain`), so a clean
 * round-trip (scan what Receive shows) lands in the name branch.
 */

import jsQR from 'jsqr';

/**
 * Decode a single RGBA frame to its QR text payload, or `null` when no
 * QR is present. `data` is a row-major RGBA buffer (`width * height * 4`
 * bytes) — a browser `ImageData.data` at runtime, a hand-rasterised
 * buffer in unit tests. Empty frames short-circuit to `null` so callers
 * can poll a not-yet-ready `<video>` without guarding every call.
 */
export function decodeQr(data: Uint8ClampedArray, width: number, height: number): string | null {
  if (width <= 0 || height <= 0) return null;
  const result = jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
  return result ? result.data : null;
}

/** URI schemes we unwrap before looking at the payload (case-insensitive). */
const KNOWN_SCHEMES = ['zkcoins', 'bitcoin'];

/**
 * A bare handle or `handle@domain`. The handle is a conservative
 * username charset; the optional domain is a dotted host. Deliberately
 * narrow so free-form text (URLs, sentences, BIP-21 amount blobs) does
 * not masquerade as a recipient. Raw hex / zk1 addresses are rejected.
 */
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:@[a-z0-9.-]+)?$/i;

/** Invoice JSON delivery credential (starts with `{`). */
const INVOICE_JSON_RE = /^\s*\{[\s\S]*\}\s*$/;

/** Upper bound on a sane recipient payload — guards against pathological blobs. */
const MAX_RECIPIENT_LEN = 8_192;

/**
 * Strip a recognised `scheme:` prefix plus any `?query`/`#fragment`
 * tail, then trim. A payload without a recognised scheme is returned
 * trimmed but otherwise untouched, so a bare address or `handle@domain`
 * passes through unchanged. Unknown schemes (e.g. `https:`) are left
 * intact on purpose — they then fail `isLikelyRecipient` and are
 * rejected rather than half-parsed.
 */
export function parseScannedRecipient(raw: string): string {
  let s = raw.trim();
  const schemeMatch = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(s);
  if (schemeMatch && KNOWN_SCHEMES.includes(schemeMatch[1].toLowerCase())) {
    s = schemeMatch[2];
  }
  // Drop a BIP-21-style `?amount=…` query and any `#fragment`.
  s = s.split('?')[0].split('#')[0];
  return s.trim();
}

/**
 * Whether `candidate` is a plausible zkCoins recipient: a `$handle`, a
 * `handle` / `handle@domain`, or Invoice JSON. Raw `zk1…` / bare hex
 * keys are rejected (identity rule: names only).
 */
export function isLikelyRecipient(candidate: string): boolean {
  if (!candidate || candidate.length > MAX_RECIPIENT_LEN) return false;
  if (INVOICE_JSON_RE.test(candidate)) return true;
  if (/\s/.test(candidate)) return false;
  if (/^zk1/i.test(candidate) || /^(0x)?[0-9a-f]{64}$/i.test(candidate)) return false;
  const handle = candidate.startsWith('$') ? candidate.slice(1) : candidate;
  if (!handle) return false;
  return HANDLE_RE.test(handle);
}

/**
 * Normalise a raw QR payload into a Send-form recipient, or `null` when
 * it is not a plausible recipient. Composes `parseScannedRecipient`
 * (unwrap scheme/query) with `isLikelyRecipient` (shape check). This is
 * the single entry point the scanner calls on every decoded frame.
 */
export function extractRecipient(raw: string): string | null {
  const candidate = parseScannedRecipient(raw);
  return isLikelyRecipient(candidate) ? candidate : null;
}
