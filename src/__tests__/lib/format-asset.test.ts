import { describe, it, expect } from 'vitest';
import { formatAssetAmount, formatAssetAmountString, shortAssetId } from '@/lib/format';

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

  it('rejects missing decimals (no guessed scaling)', () => {
    expect(() => formatAssetAmount(500, undefined as unknown as number)).toThrow(
      /non-negative integer/,
    );
  });

  it('rejects negative decimals', () => {
    expect(() => formatAssetAmount(500, -1)).toThrow(/non-negative integer/);
  });

  it('formats high decimals via string path without RangeError', () => {
    expect(formatAssetAmount(1, 255)).toBe(formatAssetAmountString('1', 255));
  });

  it('rejects non-integer and negative amounts', () => {
    expect(() => formatAssetAmount(1.5, 2)).toThrow(/non-negative integer/);
    expect(() => formatAssetAmount(-1, 2)).toThrow(/non-negative integer/);
  });

  it('rejects unsafe integers so they are not silently rounded', () => {
    expect(() => formatAssetAmount(Number.MAX_SAFE_INTEGER + 1, 0)).toThrow(/non-negative integer/);
  });

  it('formats Number.MAX_SAFE_INTEGER with decimals 0', () => {
    expect(formatAssetAmount(Number.MAX_SAFE_INTEGER, 0)).toBe('9,007,199,254,740,991');
  });
});

describe('formatAssetAmountString', () => {
  it('preserves fractional digits beyond the safe integer range', () => {
    expect(formatAssetAmountString('1000000000000000001', 18)).toBe('1.000000000000000001');
  });

  it('preserves every digit above the safe integer range', () => {
    expect(formatAssetAmountString('9223372036854775807', 0)).toBe('9,223,372,036,854,775,807');
  });

  it('rejects empty, signed, and non-decimal atomic-unit strings', () => {
    expect(() => formatAssetAmountString('', 0)).toThrow(/non-empty unsigned decimal/);
    expect(() => formatAssetAmountString('-1', 0)).toThrow(/non-empty unsigned decimal/);
    expect(() => formatAssetAmountString('1.5', 0)).toThrow(/non-empty unsigned decimal/);
  });

  it('rejects negative and fractional decimal counts', () => {
    expect(() => formatAssetAmountString('1', -1)).toThrow(/non-negative integer/);
    expect(() => formatAssetAmountString('1', 1.5)).toThrow(/non-negative integer/);
  });

  it('normalizes leading zeros and pads fractions smaller than one unit', () => {
    expect(formatAssetAmountString('000123', 5)).toBe('0.00123');
    expect(formatAssetAmountString('0000', 3)).toBe('0');
  });

  it('trims an all-zero fractional suffix back to the grouped integer', () => {
    expect(formatAssetAmountString('123000', 3)).toBe('123');
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
