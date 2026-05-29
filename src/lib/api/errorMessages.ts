/**
 * Server-error-string → user-facing message mapping.
 *
 * Issue #99. Mirrors the failure-contract table introduced by
 * `zk-coins/node` PR #31 (`router.rs::map_send_coins_error` plus
 * `handler_error_response()`). When a new error string is added
 * server-side, this table and `KNOWN_SERVER_ERRORS` below must be
 * updated in lockstep — the unit test in
 * `src/__tests__/lib/api/error-mapping.test.ts` fails otherwise.
 *
 * Lookup is two-layer:
 *   1. `SERVER_ERROR_TO_USER_MESSAGE` — exact-string match. This is the
 *      lockstep contract: every entry in `KNOWN_SERVER_ERRORS` must
 *      resolve here (asserted by the unit test) and stays in lockstep
 *      with the `api_remote.rs::error_strings_match_known_app_mapping`
 *      test in `zk-coins/node`.
 *   2. `SERVER_ERROR_PATTERNS` — regex fallback for *families* of
 *      diagnostic strings the node may emit with varying wording (e.g.
 *      `"<field> is not valid hex"` for any field name, or
 *      `"<field> must be 32 bytes (64 hex chars)"`). The node prefers
 *      diagnostic, field-naming strings; this layer keeps the UX
 *      consistent without forcing the node to flatten its messages back
 *      to the generic forms in `KNOWN_SERVER_ERRORS`.
 *
 * Patterns intentionally may overlap with `KNOWN_SERVER_ERRORS`
 * strings (e.g. the hex pattern matches both the diagnostic
 * `"<field> is not valid hex"` and the exact `"Invalid hex"`). The
 * exact-match pass runs first, so the pattern is dead code for that
 * specific string — that is fine and asserted by the unit test
 * `every KNOWN_SERVER_ERRORS string resolves via the exact-match
 * table, not via a pattern`. Catching pattern takeover matters: if a
 * future refactor deletes an exact entry, the pattern fallback might
 * silently swap the German copy for a different translation.
 */

import { ApiError } from './client';

/**
 * The exact set of `error` strings the server can emit. Used by the
 * lockstep test to assert every server-side error has a mapping. Order
 * mirrors the issue #99 table for diffability.
 */
export const KNOWN_SERVER_ERRORS = [
  // map_send_coins_error
  'Unknown account address',
  'prev_commitment_pubkey required for account update',
  'Insufficient funds',
  "In-coin not present in source's output_coins_root",
  'Source commitment not present in history MMR',
  'Coin is missing commitment',
  'Should provide an inclusion proof',
  'Coin should not exist in coin history tree',
  'Coin should not exist in tree yet',
  'Too many in-coins for one transition',
  'Too many out-coins for one transition',
  'prove failed',
  'internal error',
  // handler_error_response
  'Signature verification failed',
  'Missing signature',
  'Request timestamp too old or in the future',
  'Invalid hex',
  'Invalid address length',
  'Broadcast failed',
] as const;

/**
 * @internal — exported only for the lockstep test in
 * `error-mapping.test.ts`. Not a public API; production callers use
 * `userMessageFor()` instead.
 */
export const SERVER_ERROR_TO_USER_MESSAGE: Record<string, string> = {
  // 422 — user-fixable
  'Insufficient funds': 'Nicht genug Guthaben für diese Überweisung.',
  'Coin should not exist in coin history tree': 'Diese Coin wurde bereits versendet.',
  'Too many in-coins for one transition': 'Zu viele eingehende Coins für eine Transaktion (max 8).',
  'Too many out-coins for one transition': 'Zu viele Empfänger für eine Transaktion (max 8).',

  // 404 — user-fixable
  'Unknown account address': 'Dieser Account ist auf dem Server nicht bekannt.',

  // 401 — user-fixable
  'Signature verification failed': 'Signaturprüfung fehlgeschlagen.',
  'Missing signature': 'Anfrage ist nicht signiert.',
  'Request timestamp too old or in the future': 'Zeitstempel ausserhalb des Toleranzfensters.',

  // 422 — client-bug, generic
  "In-coin not present in source's output_coins_root":
    'Interner Fehler: Coin-Validierung fehlgeschlagen.',
  'Source commitment not present in history MMR':
    'Interner Fehler: Quellnachweis nicht in der Historie.',
  'Coin is missing commitment': 'Interner Fehler: Coin-Commitment fehlt.',
  'Should provide an inclusion proof': 'Interner Fehler: Inclusion-Proof fehlt.',
  'Coin should not exist in tree yet': 'Interner Fehler: Coin-Baum inkonsistent.',

  // 400 — client-bug, generic
  'prev_commitment_pubkey required for account update':
    'Interner Fehler: Vorheriger Public Key fehlt.',

  // 500 — operator-visible
  'prove failed': 'Beweisgenerierung fehlgeschlagen. Bitte später erneut versuchen.',
  'internal error': 'Unerwarteter Serverfehler.',

  // 503 — transient
  'Broadcast failed': 'Bitcoin-Broadcast fehlgeschlagen. Bitte später erneut versuchen.',

  // 422 — request shape
  'Invalid hex': 'Ungültige Hex-Eingabe.',
  'Invalid address length': 'Ungültige Adresslänge.',
};

/**
 * Family-level patterns for diagnostic node error strings that vary by
 * field name or wording. Tried only when no exact match is found in
 * `SERVER_ERROR_TO_USER_MESSAGE`. Order matters: specific patterns must
 * precede broader ones. Each entry maps to one of the existing German
 * user messages so the UX is consistent between exact-matched and
 * family-matched errors.
 */
const SERVER_ERROR_PATTERNS: Array<readonly [RegExp, string]> = [
  // Hex validation errors. Node emits e.g.
  // "account_address is not valid hex" — any field, any wording variant.
  [/(?:is not valid hex|invalid hex)/i, 'Ungültige Hex-Eingabe.'],
  // Address length errors. Node emits e.g.
  // "account_address must be 32 bytes (64 hex chars)" or
  // "recipient must be 32 bytes (64 hex chars)" — varies by field.
  [/(?:must be \d+ bytes|invalid address length|address length)/i, 'Ungültige Adresslänge.'],
  // Bitcoin broadcast failures. Node may emit "Broadcast failed"
  // (exact-matched above) or the diagnostic
  // "Failed to broadcast commitment inscription on-chain".
  [
    /(?:^Broadcast failed$|^Failed to broadcast)/i,
    'Bitcoin-Broadcast fehlgeschlagen. Bitte später erneut versuchen.',
  ],
];

/**
 * Map an `ApiError` to a translated, user-facing message. Falls back to
 * `Serverfehler <status>: <raw>` when the server emits an unmapped
 * string (a lockstep gap that the unit test must catch — the fallback
 * exists so production users don't see a crash, not as a permitted
 * resting state).
 */
export function userMessageFor(error: ApiError): string {
  const exact = SERVER_ERROR_TO_USER_MESSAGE[error.serverError];
  if (exact !== undefined) return exact;

  for (const [pattern, message] of SERVER_ERROR_PATTERNS) {
    if (pattern.test(error.serverError)) return message;
  }

  return `Serverfehler ${error.status}: ${error.serverError}`;
}
