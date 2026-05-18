import { describe, it, expect } from 'vitest';
import { toZkAddress } from '@/lib/format';

// `toZkAddress(hex, domain)` is a pure function — the domain is read
// from `useNetworkStore` (which the server populates via `/api/info`)
// at the call-site and passed in. The tests cover both stages
// explicitly to pin the cross-network safety: a DEV address rendered
// with `zkcoins.app` (PRD) would suggest it can be sent to from PRD,
// which is exactly the bug #95 fixes.

describe('toZkAddress (PRD domain)', () => {
  it('converts full hex address to {8chars}@zkcoins.app', () => {
    const address = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    expect(toZkAddress(address, 'zkcoins.app')).toBe('abcdef12@zkcoins.app');
  });

  it('strips 0x prefix before taking first 8 chars', () => {
    const address = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    expect(toZkAddress(address, 'zkcoins.app')).toBe('abcdef12@zkcoins.app');
  });

  it('returns "@<domain>" for empty hex but non-empty domain', () => {
    expect(toZkAddress('', 'zkcoins.app')).toBe('@zkcoins.app');
  });

  it('returns correct 8-char prefix for all-same-char address', () => {
    const address = 'a'.repeat(64);
    expect(toZkAddress(address, 'zkcoins.app')).toBe('aaaaaaaa@zkcoins.app');
  });

  it('handles short address (less than 8 chars)', () => {
    expect(toZkAddress('abcd', 'zkcoins.app')).toBe('abcd@zkcoins.app');
  });

  it('handles address that is exactly 8 chars', () => {
    expect(toZkAddress('12345678', 'zkcoins.app')).toBe('12345678@zkcoins.app');
  });

  it('handles 0x-prefixed short address', () => {
    expect(toZkAddress('0xabcd', 'zkcoins.app')).toBe('abcd@zkcoins.app');
  });

  it('lowercases the hex prefix so casing variations render identically', () => {
    expect(toZkAddress('ABCDEF1234567890', 'zkcoins.app')).toBe('abcdef12@zkcoins.app');
    expect(toZkAddress('0xABCDEF1234567890', 'zkcoins.app')).toBe('abcdef12@zkcoins.app');
  });
});

describe('toZkAddress (DEV domain — cross-network safety)', () => {
  it('uses the injected DEV domain for the suffix', () => {
    const address = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    expect(toZkAddress(address, 'dev.zkcoins.app')).toBe('abcdef12@dev.zkcoins.app');
  });

  it('uses the injected DEV domain for the empty-input fallback', () => {
    expect(toZkAddress('', 'dev.zkcoins.app')).toBe('@dev.zkcoins.app');
  });

  it('keeps the prefix stripping consistent across domains', () => {
    expect(toZkAddress('0xABCD', 'dev.zkcoins.app')).toBe('abcd@dev.zkcoins.app');
  });
});

describe('toZkAddress (loading state)', () => {
  it('returns empty string when the domain has not been reported yet', () => {
    // `/api/info` has not landed; callers treat this as "still loading".
    expect(toZkAddress('abcd', '')).toBe('');
  });

  it('returns empty string even when the hex is empty and the domain is missing', () => {
    expect(toZkAddress('', '')).toBe('');
  });
});
