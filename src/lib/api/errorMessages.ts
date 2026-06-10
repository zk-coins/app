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
 * ## i18n
 *
 * The user-facing copy now lives in the message catalogs
 * (`messages/{de,en}.json` under the `errors.*` keys) rather than as
 * hardcoded German literals here. The server-error string maps to a
 * catalog KEY (`SERVER_ERROR_TO_KEY`); the actual translation is resolved
 * by a translator. `userMessageFor` accepts an optional translator `t`
 * (the `errors`-namespaced `useTranslations('errors')` from a component)
 * so the message renders in the active locale. When called without one
 * (pure-function contexts, the lockstep test) it falls back to a
 * default-locale (`de`) translator built from the catalog — so the German
 * copy still comes from the catalog, not from this file.
 *
 * Lookup is two-layer:
 *   1. `SERVER_ERROR_TO_KEY` — exact-string match (the lockstep contract).
 *   2. `SERVER_ERROR_PATTERNS` — regex fallback for *families* of
 *      diagnostic strings the node may emit with varying wording.
 */

import { createTranslator } from 'next-intl';

import deMessages from '../../../messages/de.json';
import { defaultLocale } from '@/i18n/config';
import { ApiError, JobFailedError } from './client';

/** A translator over the `errors` namespace — e.g. `useTranslations('errors')`. */
export type ErrorTranslator = (key: string, values?: Record<string, string | number>) => string;

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
 * Server-error string → catalog key (under the `errors` namespace). Every
 * `KNOWN_SERVER_ERRORS` entry must resolve here (asserted by the unit
 * test) and stay in lockstep with the node's
 * `api_remote.rs::error_strings_match_known_app_mapping` test.
 */
export const SERVER_ERROR_TO_KEY: Record<string, string> = {
  // 422 — user-fixable
  'Insufficient funds': 'insufficientFunds',
  'Coin should not exist in coin history tree': 'coinAlreadySent',
  'Too many in-coins for one transition': 'tooManyInCoins',
  'Too many out-coins for one transition': 'tooManyOutCoins',

  // 404 — user-fixable
  'Unknown account address': 'unknownAccount',

  // 401 — user-fixable
  'Signature verification failed': 'signatureFailed',
  'Missing signature': 'missingSignature',
  'Request timestamp too old or in the future': 'timestampOutOfRange',

  // 422 — client-bug, generic
  "In-coin not present in source's output_coins_root": 'inCoinMissing',
  'Source commitment not present in history MMR': 'sourceCommitmentMissing',
  'Coin is missing commitment': 'coinMissingCommitment',
  'Should provide an inclusion proof': 'missingInclusionProof',
  'Coin should not exist in tree yet': 'coinTreeInconsistent',

  // 400 — client-bug, generic
  'prev_commitment_pubkey required for account update': 'prevPubkeyMissing',

  // 500 — operator-visible
  'prove failed': 'proveFailed',
  'internal error': 'internalError',

  // 503 — transient
  'Broadcast failed': 'broadcastFailed',

  // 422 — request shape
  'Invalid hex': 'invalidHex',
  'Invalid address length': 'invalidAddressLength',
};

/** Default-locale (`de`) translator over the `errors` namespace. Cast to
 *  the loose {@link ErrorTranslator} shape so callers (and the
 *  `serverErrorFallback` placeholder substitution) need not satisfy
 *  next-intl's compile-time message-key typing for a dynamically-chosen
 *  key. */
const defaultTranslator: ErrorTranslator = createTranslator({
  locale: defaultLocale,
  messages: deMessages,
  namespace: 'errors',
}) as unknown as ErrorTranslator;

/**
 * @internal — exported only for the lockstep test in
 * `error-mapping.test.ts`. Resolves every {@link SERVER_ERROR_TO_KEY}
 * entry through the default-locale (`de`) catalog so the test can assert
 * each known server error has a real, non-fallback message. Production
 * callers use `userMessageFor()`.
 */
export const SERVER_ERROR_TO_USER_MESSAGE: Record<string, string> = Object.fromEntries(
  Object.entries(SERVER_ERROR_TO_KEY).map(([serverError, key]) => [
    serverError,
    defaultTranslator(key),
  ]),
);

/**
 * Family-level patterns for diagnostic node error strings that vary by
 * field name or wording → catalog key. Tried only when no exact match is
 * found. Order matters: specific patterns must precede broader ones.
 */
const SERVER_ERROR_PATTERNS: Array<readonly [RegExp, string]> = [
  [/(?:is not valid hex|invalid hex)/i, 'invalidHex'],
  [/(?:must be \d+ bytes|invalid address length|address length)/i, 'invalidAddressLength'],
  [/(?:^Broadcast failed$|^Failed to broadcast)/i, 'broadcastFailed'],
];

/**
 * Map an `ApiError` or `JobFailedError` to a translated, user-facing
 * message. Pass the `errors`-namespaced translator (`useTranslations(
 * 'errors')`) from a component to render in the active locale; omit it
 * (pure-function contexts / tests) to get the default-locale copy.
 *
 * Falls back to a translated "Server error <status>: <raw>" string when
 * the server emits an unmapped error string (a lockstep gap the unit
 * test must catch — the fallback exists so users don't see a crash).
 */
export function userMessageFor(
  error: ApiError | JobFailedError,
  t: ErrorTranslator = defaultTranslator,
): string {
  const serverError = error.serverError;
  if (serverError !== undefined) {
    const exactKey = SERVER_ERROR_TO_KEY[serverError];
    if (exactKey !== undefined) return t(exactKey);

    for (const [pattern, key] of SERVER_ERROR_PATTERNS) {
      if (pattern.test(serverError)) return t(key);
    }
  }

  return t('serverErrorFallback', {
    status: error.status,
    detail: serverError ?? t('unknownError'),
  });
}
