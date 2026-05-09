export const APP_VERSION = '0.9.0';

export const SATS_PER_BTC = 100_000_000;

export function satsToBtc(sats: number): number {
  return sats / SATS_PER_BTC;
}

export function formatBtc(sats: number, decimals = 8): string {
  return (sats / SATS_PER_BTC).toFixed(decimals);
}

export function formatBtcSigned(sats: number, decimals = 8): string {
  const sign = sats >= 0 ? '+' : '−';
  return `${sign}${(Math.abs(sats) / SATS_PER_BTC).toFixed(decimals)}`;
}

/** Compact BTC formatter — trims trailing zeros, keeps at least 2 decimals.
 *  e.g. 14_000_000 sats -> "+0.14", 210_000 -> "+0.0021", 100_000 -> "+0.001"
 */
export function formatBtcCompact(sats: number): string {
  if (sats === 0) return '0.00';
  const sign = sats >= 0 ? '+' : '−';
  const abs = Math.abs(sats) / SATS_PER_BTC;
  let str = abs.toFixed(8);
  // Strip trailing zeros, but keep at least 2 decimals after the dot.
  while (str.endsWith('0') && !/\.\d{0,2}$/.test(str)) {
    str = str.slice(0, -1);
  }
  return `${sign}${str}`;
}

// Mock USD price during mock-prover phase. Wire to a real oracle later.
export const MOCK_BTC_USD = 62_000;

export function formatUsd(sats: number, price = MOCK_BTC_USD): string {
  const usd = (sats / SATS_PER_BTC) * price;
  return usd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function toZkAddress(hexAddress: string): string {
  if (!hexAddress) return '@zkcoins.app';
  const stripped = hexAddress.replace(/^0x/, '');
  return `${stripped.slice(0, 8)}@zkcoins.app`;
}

export function truncateAddress(addr: string, head = 10, tail = 8): string {
  if (!addr) return '';
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}...${addr.slice(-tail)}`;
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function formatTimeOnly(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
