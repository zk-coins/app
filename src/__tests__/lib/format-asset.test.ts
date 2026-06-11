import { describe, it, expect } from 'vitest';
import { formatAssetAmount, shortAssetId } from '@/lib/format';

describe('formatAssetAmount', () => {
  it('renders a 0-decimal asset as a plain integer with grouping', () => {
    expect(formatAssetAmount(1_234_567, 0)).toBe('1,234,567');
  });

  it('scales by decimals and trims trailing zeros', () => {
    // 12_345 atomic units at 2 decimals = 123.45
    expect(formatAssetAmount(12_345, 2)).toBe('123.45');
    // exact integer at 2 decimals keeps no fraction
    expect(formatAssetAmount(10_000, 2)).toBe('100');
  });

  it('handles 8-decimal (BTC-like) assets', () => {
    expect(formatAssetAmount(100_000_000, 8)).toBe('1');
    expect(formatAssetAmount(10_000, 8)).toBe('0.0001');
  });

  it('treats a missing decimals as 0 (no guessed scaling)', () => {
    expect(formatAssetAmount(500, undefined)).toBe('500');
  });

  it('treats a negative decimals as 0 (defensive)', () => {
    expect(formatAssetAmount(500, -1)).toBe('500');
  });
});

describe('shortAssetId', () => {
  it('elides the middle of a 32-byte hex id', () => {
    const id = 'ab12cd34'.padEnd(64, 'e');
    expect(shortAssetId(id)).toBe(`${id.slice(0, 8)}…${id.slice(-4)}`);
  });

  it('returns short ids unchanged', () => {
    expect(shortAssetId('abcd')).toBe('abcd');
    expect(shortAssetId('aabbccddeeff')).toBe('aabbccddeeff');
  });
});
