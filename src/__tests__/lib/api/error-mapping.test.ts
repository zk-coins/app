import { describe, it, expect } from 'vitest';
import { ApiError } from '@/lib/api/client';
import {
  KNOWN_SERVER_ERRORS,
  SERVER_ERROR_PATTERNS,
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
    // the exact string. This test guards that ordering: if a future
    // refactor deletes an exact entry, the pattern fallback might
    // silently swap the German copy for a different translation, and
    // the assertion below would catch it.
    it.each(KNOWN_SERVER_ERRORS)(
      'resolves "%s" via the exact-match table, not via a family pattern',
      (serverError) => {
        expect(SERVER_ERROR_TO_USER_MESSAGE[serverError]).toBeDefined();
        // Sanity check: even if a pattern also matches, the exact entry
        // is the one that wins (and the lockstep test above asserts the
        // exact entry's translation is non-fallback).
        const exact = SERVER_ERROR_TO_USER_MESSAGE[serverError];
        const matchingPattern = SERVER_ERROR_PATTERNS.find(([re]) => re.test(serverError));
        if (matchingPattern && matchingPattern[1] !== exact) {
          // Different translations between the exact entry and the
          // overlapping pattern — log it so a future refactor that
          // accidentally relies on the pattern is caught.
          expect(userMessageFor(new ApiError(500, serverError))).toBe(exact);
        }
      },
    );
  });
});
