import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SATS_PER_BTC,
  satsToBtc,
  formatBtc,
  formatBtcSigned,
  formatBtcCompact,
  formatUsd,
  truncateAddress,
  formatRelative,
  formatTimeOnly,
} from '@/lib/format';

describe('SATS_PER_BTC constant', () => {
  it('equals 100_000_000', () => {
    expect(SATS_PER_BTC).toBe(100_000_000);
  });
});

describe('satsToBtc', () => {
  it('converts sats to BTC', () => {
    expect(satsToBtc(100_000_000)).toBe(1);
  });

  it('converts zero', () => {
    expect(satsToBtc(0)).toBe(0);
  });

  it('converts fractional amounts', () => {
    expect(satsToBtc(1)).toBe(0.00000001);
  });

  it('converts large amounts', () => {
    expect(satsToBtc(2_100_000_000_000_000)).toBe(21_000_000);
  });
});

describe('formatBtc', () => {
  it('formats zero sats', () => {
    expect(formatBtc(0)).toBe('0.00000000');
  });

  it('formats 1 BTC', () => {
    expect(formatBtc(100_000_000)).toBe('1.00000000');
  });

  it('formats fractional sats', () => {
    expect(formatBtc(10_000)).toBe('0.00010000');
  });

  it('respects custom decimals', () => {
    expect(formatBtc(100_000_000, 2)).toBe('1.00');
  });

  it('formats with 4 decimals', () => {
    expect(formatBtc(50_000_000, 4)).toBe('0.5000');
  });
});

describe('formatBtcSigned', () => {
  it('prepends + for positive values', () => {
    expect(formatBtcSigned(10_000)).toBe('+0.00010000');
  });

  it('uses minus sign for negative values', () => {
    const result = formatBtcSigned(-10_000);
    // The function uses a special minus character (−, U+2212)
    expect(result).toContain('0.00010000');
    expect(result[0]).not.toBe('+');
  });

  it('formats zero as positive', () => {
    expect(formatBtcSigned(0)).toBe('+0.00000000');
  });

  it('respects custom decimals', () => {
    expect(formatBtcSigned(100_000_000, 2)).toBe('+1.00');
  });
});

describe('formatBtcCompact', () => {
  it('returns 0.00 for zero', () => {
    expect(formatBtcCompact(0)).toBe('0.00');
  });

  it('trims trailing zeros but keeps at least 2 decimals', () => {
    // 14_000_000 sats = 0.14 BTC
    expect(formatBtcCompact(14_000_000)).toBe('+0.14');
  });

  it('keeps significant trailing digits', () => {
    // 210_000 sats = 0.00210000 -> trimmed to 0.0021
    expect(formatBtcCompact(210_000)).toBe('+0.0021');
  });

  it('trims correctly for round values', () => {
    // 100_000 sats = 0.001
    expect(formatBtcCompact(100_000)).toBe('+0.001');
  });

  it('uses minus sign for negative values', () => {
    const result = formatBtcCompact(-10_000);
    expect(result).toContain('0.0001');
    expect(result[0]).not.toBe('+');
  });

  it('formats 1 BTC', () => {
    expect(formatBtcCompact(100_000_000)).toBe('+1.00');
  });
});

describe('formatUsd', () => {
  it('formats with default mock BTC price', () => {
    // 100_000_000 sats * $62,000 = $62,000.00
    const result = formatUsd(100_000_000);
    expect(result).toBe('62,000.00');
  });

  it('formats zero', () => {
    expect(formatUsd(0)).toBe('0.00');
  });

  it('uses custom price', () => {
    // 100_000_000 sats * $100,000 = $100,000.00
    const result = formatUsd(100_000_000, 100_000);
    expect(result).toBe('100,000.00');
  });

  it('formats small amounts', () => {
    // 10_000 sats * $62,000 = $6.20
    const result = formatUsd(10_000);
    expect(result).toBe('6.20');
  });
});

describe('truncateAddress', () => {
  it('returns empty string for empty input', () => {
    expect(truncateAddress('')).toBe('');
  });

  it('returns short addresses unchanged', () => {
    expect(truncateAddress('abc123')).toBe('abc123');
  });

  it('truncates long addresses with default head/tail', () => {
    const addr = 'a'.repeat(64);
    const result = truncateAddress(addr);
    expect(result).toBe('aaaaaaaaaa...aaaaaaaa');
    expect(result.length).toBe(21); // 10 + 3 + 8
  });

  it('uses custom head and tail lengths', () => {
    const addr = 'abcdefghijklmnopqrstuvwxyz';
    const result = truncateAddress(addr, 4, 4);
    expect(result).toBe('abcd...wxyz');
  });

  it('returns address unchanged when shorter than head+tail+3', () => {
    const addr = 'abcdefghijklmnopqrst'; // 20 chars, 10+8+3=21
    expect(truncateAddress(addr)).toBe(addr);
  });
});

describe('formatRelative', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for less than 60 seconds ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:30.000Z'));
    expect(formatRelative(new Date('2025-01-01T12:00:00.000Z').getTime())).toBe('just now');
  });

  it('returns minutes ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:05:00.000Z'));
    expect(formatRelative(new Date('2025-01-01T12:00:00.000Z').getTime())).toBe('5m ago');
  });

  it('returns hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T15:00:00.000Z'));
    expect(formatRelative(new Date('2025-01-01T12:00:00.000Z').getTime())).toBe('3h ago');
  });

  it('returns days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-03T12:00:00.000Z'));
    expect(formatRelative(new Date('2025-01-01T12:00:00.000Z').getTime())).toBe('2d ago');
  });
});

describe('formatTimeOnly', () => {
  it('formats a timestamp as HH:MM:SS', () => {
    // Use a fixed UTC timestamp and check format
    const ts = new Date('2025-01-01T08:05:09.000Z').getTime();
    const result = formatTimeOnly(ts);
    // Result depends on local timezone, but format should be HH:MM:SS
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('pads single digits', () => {
    // Any timestamp — just check format
    const ts = Date.now();
    const result = formatTimeOnly(ts);
    const parts = result.split(':');
    expect(parts).toHaveLength(3);
    parts.forEach((p) => expect(p).toHaveLength(2));
  });
});
