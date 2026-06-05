import { describe, it, expect } from 'vitest';
import { ApiError, JobFailedError } from '@/lib/api/client';
import {
  KNOWN_SERVER_ERRORS,
  SERVER_ERROR_TO_USER_MESSAGE,
  userMessageFor,
} from '@/lib/api/errorMessages';

describe('userMessageFor', () => {
  it.each(KNOWN_SERVER_ERRORS)(
    'has a non-fallback German message for every known server error: %s',
    (serverError) => {
      // Lockstep test: when `zk-coins/node::map_send_coins_error`
      // grows, both `KNOWN_SERVER_ERRORS` and the mapping in
      // `errorMessages.ts` must be updated together. Failure here
      // means the app would show the raw `Serverfehler …` fallback
      // for a string the server is already emitting in production.
      const apiErr = new ApiError(500, serverError);
      const msg = userMessageFor(apiErr);
      expect(msg, `unmapped server error: ${serverError}`).not.toMatch(/^Serverfehler /);
      expect(msg.length).toBeGreaterThan(5);
    },
  );

  it('falls back to "Serverfehler <status>: <raw>" for an unmapped error string', () => {
    const apiErr = new ApiError(418, "I'm a teapot");
    expect(userMessageFor(apiErr)).toBe("Serverfehler 418: I'm a teapot");
  });

  it('falls back when serverError is the raw text body (non-JSON 5xx)', () => {
    // request() preserves the raw body in `serverError` when the body
    // is not JSON. Make sure the fallback still produces a stable,
    // user-readable string.
    const apiErr = new ApiError(502, 'Bad Gateway');
    expect(userMessageFor(apiErr)).toBe('Serverfehler 502: Bad Gateway');
  });

  describe('family pattern matching', () => {
    // The node prefers diagnostic, field-naming error strings (e.g.
    // "account_address is not valid hex") over the generic forms in
    // KNOWN_SERVER_ERRORS ("Invalid hex"). The SERVER_ERROR_PATTERNS
    // fallback in errorMessages.ts keeps the user-facing copy stable
    // across both shapes. These tests pin that behavior.

    it('maps diagnostic hex validation errors via family pattern', () => {
      const apiErr = new ApiError(422, 'account_address is not valid hex');
      expect(userMessageFor(apiErr)).toBe('Ungültige Hex-Eingabe.');
    });

    it('maps diagnostic address-length errors via family pattern (any field name)', () => {
      // Variant with a different field name than the documented case —
      // proves the pattern matches the *family*, not a specific field.
      const apiErr = new ApiError(422, 'recipient must be 32 bytes (64 hex chars)');
      expect(userMessageFor(apiErr)).toBe('Ungültige Adresslänge.');
    });

    it('maps diagnostic broadcast failure variants via family pattern', () => {
      const apiErr = new ApiError(503, 'Failed to broadcast commitment inscription on-chain');
      expect(userMessageFor(apiErr)).toBe(
        'Bitcoin-Broadcast fehlgeschlagen. Bitte später erneut versuchen.',
      );
    });

    // Patterns are allowed to overlap with KNOWN_SERVER_ERRORS strings —
    // e.g. /invalid hex/i matches both the diagnostic
    // "account_address is not valid hex" and the exact "Invalid hex".
    // The exact-match table runs first, so the pattern is dead code for
    // the exact string. This test pins the lockstep invariant: every
    // known server error must resolve via the exact-match table. If a
    // future refactor deletes an exact entry, the pattern fallback
    // could silently swap the German copy for a different translation;
    // this assertion catches that before the build ships.
    it.each(KNOWN_SERVER_ERRORS)(
      'resolves "%s" via the exact-match table, not via a family pattern',
      (serverError) => {
        expect(SERVER_ERROR_TO_USER_MESSAGE[serverError]).toBeDefined();
      },
    );
  });

  describe('async JobFailedError mapping (issue #99, async leg)', () => {
    // The node emits the same failure-contract strings on both legs:
    // synchronously at admit time (ApiError) and asynchronously when a
    // queued job ends in `failed` / `cancelled` (JobFailedError, e.g.
    // a proving failure detected long after the 202). The send toast
    // must show the same German copy either way.

    it('maps a known server error carried by an async job failure', () => {
      const jobErr = new JobFailedError('job-1', 'failed', 'prove failed');
      expect(userMessageFor(jobErr)).toBe(
        'Beweisgenerierung fehlgeschlagen. Bitte später erneut versuchen.',
      );
    });

    it('maps family-pattern diagnostics on the async leg too', () => {
      const jobErr = new JobFailedError('job-2', 'failed', 'Failed to broadcast inscription');
      expect(userMessageFor(jobErr)).toBe(
        'Bitcoin-Broadcast fehlgeschlagen. Bitte später erneut versuchen.',
      );
    });

    it('falls back to "Serverfehler <status>: <raw>" for an unmapped async error string', () => {
      const jobErr = new JobFailedError('job-3', 'cancelled', 'operator pulled the plug');
      expect(userMessageFor(jobErr)).toBe('Serverfehler cancelled: operator pulled the plug');
    });

    it('falls back with a German placeholder when the job carries no error string', () => {
      // The node may terminate a job without an `error` field —
      // `JobFailedError.serverError` is undefined then.
      const jobErr = new JobFailedError('job-4', 'failed');
      expect(userMessageFor(jobErr)).toBe('Serverfehler failed: unbekannter Fehler');
    });
  });
});
