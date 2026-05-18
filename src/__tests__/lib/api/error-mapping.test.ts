import { describe, it, expect } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { KNOWN_SERVER_ERRORS, userMessageFor } from '@/lib/api/errorMessages';

describe('userMessageFor', () => {
  it.each(KNOWN_SERVER_ERRORS)(
    'has a non-fallback German message for every known server error: %s',
    (serverError) => {
      // Lockstep test: when `zk-coins/server::map_send_coins_error`
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
});
