import { describe, it, expect } from 'vitest';
import { isPasskeySupported, PasskeyPrfUnsupportedError } from '@/lib/crypto/passkey';

describe('passkey utilities', () => {
  it('isPasskeySupported returns boolean', () => {
    const result = isPasskeySupported();
    expect(typeof result).toBe('boolean');
  });

  it('PasskeyPrfUnsupportedError has correct name and message', () => {
    const error = new PasskeyPrfUnsupportedError();
    expect(error.name).toBe('PasskeyPrfUnsupportedError');
    expect(error.message).toBe('PRF extension is not supported on this device');
    expect(error).toBeInstanceOf(Error);
  });

  it('PasskeyPrfUnsupportedError can be caught as Error', () => {
    try {
      throw new PasskeyPrfUnsupportedError();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(PasskeyPrfUnsupportedError);
    }
  });
});
