import { describe, it, expect } from 'vitest';
import { toZkAddress } from '@/lib/format';

describe('toZkAddress', () => {
  it('converts full hex address to {8chars}@zkcoins.app', () => {
    const address = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    expect(toZkAddress(address)).toBe('abcdef12@zkcoins.app');
  });

  it('strips 0x prefix before taking first 8 chars', () => {
    const address = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    expect(toZkAddress(address)).toBe('abcdef12@zkcoins.app');
  });

  it('handles empty string', () => {
    expect(toZkAddress('')).toBe('@zkcoins.app');
  });

  it('returns correct 8-char prefix for all-same-char address', () => {
    const address = 'a'.repeat(64);
    expect(toZkAddress(address)).toBe('aaaaaaaa@zkcoins.app');
  });

  it('handles short address (less than 8 chars)', () => {
    expect(toZkAddress('abcd')).toBe('abcd@zkcoins.app');
  });

  it('handles address that is exactly 8 chars', () => {
    expect(toZkAddress('12345678')).toBe('12345678@zkcoins.app');
  });

  it('handles 0x-prefixed short address', () => {
    expect(toZkAddress('0xabcd')).toBe('abcd@zkcoins.app');
  });
});
