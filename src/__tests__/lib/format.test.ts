import { describe, it, expect } from 'vitest';
import { toZkAddress, toDisplayName } from '@/lib/format';

describe('toDisplayName', () => {
  it('formats username@domain', () => {
    expect(toDisplayName('alice', 'zkcoins.app')).toBe('alice@zkcoins.app');
  });

  it('returns bare username when domain is empty', () => {
    expect(toDisplayName('alice', '')).toBe('alice');
  });

  it('returns empty without a username', () => {
    expect(toDisplayName(undefined, 'zkcoins.app')).toBe('');
    expect(toDisplayName('', 'zkcoins.app')).toBe('');
  });
});

describe('toZkAddress (name-only identity)', () => {
  it('formats a username with domain', () => {
    expect(toZkAddress('alice', 'zkcoins.app')).toBe('alice@zkcoins.app');
  });

  it('refuses raw hex keys as identity', () => {
    const hex = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    expect(toZkAddress(hex, 'zkcoins.app')).toBe('');
  });

  it('refuses zk1 bech32 as identity display', () => {
    expect(
      toZkAddress('zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', 'zkcoins.app'),
    ).toBe('');
  });

  it('returns empty when domain missing for a username', () => {
    expect(toZkAddress('alice', '')).toBe('alice');
  });
});
