import { describe, it, expect } from 'vitest';
import { FEATURES } from '@/lib/features';

describe('FEATURES', () => {
  it('exposes every flag as a boolean', () => {
    expect(typeof FEATURES.PASSKEY).toBe('boolean');
    expect(typeof FEATURES.FAUCET).toBe('boolean');
    expect(typeof FEATURES.USERNAMES).toBe('boolean');
    expect(typeof FEATURES.APPS_DIRECTORY).toBe('boolean');
    expect(typeof FEATURES.DEV_ROUTES).toBe('boolean');
  });

  it('exposes exactly the five known flags', () => {
    expect(Object.keys(FEATURES).sort()).toEqual([
      'APPS_DIRECTORY',
      'DEV_ROUTES',
      'FAUCET',
      'PASSKEY',
      'USERNAMES',
    ]);
  });
});
