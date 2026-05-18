/**
 * Server-error-string → user-facing message mapping.
 *
 * Issue #99. Mirrors the failure-contract table introduced by
 * `zk-coins/server` PR #31 (`server.rs::map_send_coins_error` plus
 * `handler_error_response()`). When a new error string is added
 * server-side, this table and `KNOWN_SERVER_ERRORS` below must be
 * updated in lockstep — the unit test in
 * `src/__tests__/lib/api/error-mapping.test.ts` fails otherwise.
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

const SERVER_ERROR_TO_USER_MESSAGE: Record<string, string> = {
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
 * Map an `ApiError` to a translated, user-facing message. Falls back to
 * `Serverfehler <status>: <raw>` when the server emits an unmapped
 * string (a lockstep gap that the unit test must catch — the fallback
 * exists so production users don't see a crash, not as a permitted
 * resting state).
 */
export function userMessageFor(error: ApiError): string {
  return (
    SERVER_ERROR_TO_USER_MESSAGE[error.serverError] ??
    `Serverfehler ${error.status}: ${error.serverError}`
  );
}
