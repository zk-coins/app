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

export function formatUsd(sats: number, price: number): string {
  const usd = (sats / SATS_PER_BTC) * price;
  return usd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Render a receive **name** for display/QR.
 *
 * Identity rule (mandate): present names only — never a raw `zk1…`
 * address or bare key as the primary identity. When a username is set,
 * returns `username@domain` (or bare username when the domain is empty).
 * When only a domain is known and no username, returns empty so the UI
 * can show a name-setup prompt instead of a truncated key.
 *
 * The second argument is kept for call-site compatibility; the first is
 * the username (preferred) or empty.
 */
export function toDisplayName(username: string | undefined, domain: string): string {
  if (!username) return '';
  if (!domain) return username;
  return `${username}@${domain}`;
}

/**
 * @deprecated Prefer {@link toDisplayName}. Kept as a thin alias so
 * existing screens compile while identity migration completes. Does
 * **not** encode raw addresses — returns empty without a username.
 */
export function toZkAddress(usernameOrAddress: string, domain: string): string {
  // If it looks like a bare zk1 / hex key, refuse to format it as identity.
  if (/^zk1/i.test(usernameOrAddress) || /^[0-9a-f]{64}$/i.test(usernameOrAddress)) {
    return '';
  }
  return toDisplayName(usernameOrAddress, domain);
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

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Format a raw integer asset amount (atomic units) using the asset's
 * `decimals`. Neutral multi-asset: there is no BTC/sats assumption — an
 * asset minted with `decimals: 0` renders as a plain integer, one with
 * `decimals: 8` like BTC. Invalid `decimals` or `amount` throw; callers
 * must show an unavailable label rather than invent a scale.
 */
export function formatAssetAmount(amount: number, decimals: number): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0) {
    throw new Error(
      `formatAssetAmount: decimals must be a non-negative integer, got ${JSON.stringify(decimals)}`,
    );
  }
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(
      `formatAssetAmount: amount must be a non-negative integer, got ${JSON.stringify(amount)}`,
    );
  }
  return formatAssetAmountString(String(amount), decimals);
}

/** Format an arbitrary-precision atomic-unit digit string without numeric conversion. */
export function formatAssetAmountString(atomicDigits: string, decimals: number): string {
  if (!/^[0-9]+$/.test(atomicDigits)) {
    throw new Error(
      `formatAssetAmountString: atomicDigits must be a non-empty unsigned decimal digit string, got ${JSON.stringify(atomicDigits)}`,
    );
  }
  if (!Number.isSafeInteger(decimals) || decimals < 0) {
    throw new Error(
      `formatAssetAmountString: decimals must be a non-negative integer, got ${JSON.stringify(decimals)}`,
    );
  }

  const digits = atomicDigits.replace(/^0+(?=\d)/, '');
  const decimalIndex = digits.length - decimals;
  const integerDigits = decimalIndex > 0 ? digits.slice(0, decimalIndex) : '0';
  const groupedInteger = integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  if (decimals === 0) return groupedInteger;

  const fractionalDigits =
    decimalIndex > 0
      ? digits.slice(decimalIndex).replace(/0+$/, '')
      : `${'0'.repeat(-decimalIndex)}${digits}`.replace(/0+$/, '');
  return fractionalDigits.length > 0 ? `${groupedInteger}.${fractionalDigits}` : groupedInteger;
}

/** Short form of a 32-byte hex asset id — the trust anchor shown next to
 *  the (spoofable) human name. e.g. `ab12cd34…ef56`. */
export function shortAssetId(assetId: string): string {
  if (assetId.length <= 12) return assetId;
  return `${assetId.slice(0, 8)}…${assetId.slice(-4)}`;
}

export function formatTimeOnly(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
