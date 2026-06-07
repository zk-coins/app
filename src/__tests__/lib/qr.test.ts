/**
 * Unit tests for `src/lib/qr.ts`.
 *
 * `decodeQr` is exercised with a real round-trip: a payload is encoded to
 * a QR matrix by the `qrcode` package, rasterised to an RGBA buffer here
 * (the same shape a browser `<canvas>` `getImageData` yields), and fed
 * back through jsQR. No mock of the decoder — the assertion is that a
 * genuine QR image decodes to exactly the bytes that went in, which is
 * the property the scanner relies on.
 *
 * `parseScannedRecipient` / `isLikelyRecipient` / `extractRecipient` are
 * covered branch-by-branch, including the Receive-screen round-trip shape
 * (`<8hex>@<domain>`) and the rejection of free-form / oversized junk.
 */

import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import { decodeQr, extractRecipient, isLikelyRecipient, parseScannedRecipient } from '@/lib/qr';

/**
 * Encode `text` to a QR and rasterise it to an RGBA buffer with a quiet
 * zone, returning `{ data, width, height }` exactly as a canvas frame
 * would. `scale` px per module, `quiet` modules of white border.
 */
function rasterizeQr(text: string, scale = 6, quiet = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const dim = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!qr.modules.data[y * size + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const py = (y + quiet) * scale + dy;
          const px = (x + quiet) * scale + dx;
          const i = (py * dim + px) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 255;
        }
      }
    }
  }
  return { data, width: dim, height: dim };
}

describe('decodeQr — real round-trip', () => {
  it('decodes a hex address QR back to its payload', () => {
    const payload = 'a'.repeat(64);
    const { data, width, height } = rasterizeQr(payload);
    expect(decodeQr(data, width, height)).toBe(payload);
  });

  it('decodes the Receive-screen username@domain form', () => {
    const payload = '1a2b3c4d@dev.zkcoins.app';
    const { data, width, height } = rasterizeQr(payload);
    expect(decodeQr(data, width, height)).toBe(payload);
  });

  it('returns null for a blank (QR-free) frame', () => {
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    expect(decodeQr(data, width, height)).toBeNull();
  });

  it('returns null for a zero-width frame without invoking the decoder', () => {
    expect(decodeQr(new Uint8ClampedArray(0), 0, 10)).toBeNull();
  });

  it('returns null for a zero-height frame', () => {
    expect(decodeQr(new Uint8ClampedArray(0), 10, 0)).toBeNull();
  });
});

describe('parseScannedRecipient', () => {
  it('trims surrounding whitespace', () => {
    expect(parseScannedRecipient('  bob@zkcoins.app  ')).toBe('bob@zkcoins.app');
  });

  it('strips a zkcoins: scheme', () => {
    expect(parseScannedRecipient('zkcoins:1a2b3c4d@dev.zkcoins.app')).toBe(
      '1a2b3c4d@dev.zkcoins.app',
    );
  });

  it('strips a bitcoin: scheme case-insensitively and drops the ?query', () => {
    expect(parseScannedRecipient('BITCOIN:' + 'b'.repeat(64) + '?amount=0.1')).toBe('b'.repeat(64));
  });

  it('drops a #fragment', () => {
    expect(parseScannedRecipient('alice@zkcoins.app#note')).toBe('alice@zkcoins.app');
  });

  it('leaves an unrecognised scheme (https:) intact for later rejection', () => {
    expect(parseScannedRecipient('https://zkcoins.app/u/alice')).toBe(
      'https://zkcoins.app/u/alice',
    );
  });
});

describe('isLikelyRecipient', () => {
  it.each([
    ['0x' + 'a'.repeat(64)],
    ['A'.repeat(64)],
    ['$alice'],
    ['alice'],
    ['1a2b3c4d@dev.zkcoins.app'],
    ['bob.smith_1@zkcoins.app'],
  ])('accepts %s', (value) => {
    expect(isLikelyRecipient(value)).toBe(true);
  });

  it.each([
    [''],
    ['$'],
    ['hello world'],
    ['!!!'],
    ['https://zkcoins.app/u/alice'],
    ['a'.repeat(101)],
  ])('rejects %s', (value) => {
    expect(isLikelyRecipient(value)).toBe(false);
  });
});

describe('extractRecipient', () => {
  it('unwraps a scheme and returns the recipient', () => {
    expect(extractRecipient('zkcoins:1a2b3c4d@dev.zkcoins.app')).toBe('1a2b3c4d@dev.zkcoins.app');
  });

  it('returns the bare recipient unchanged', () => {
    expect(extractRecipient('  ' + 'f'.repeat(64) + '  ')).toBe('f'.repeat(64));
  });

  it('returns null for a non-recipient payload', () => {
    expect(extractRecipient('https://example.com/not-an-address')).toBeNull();
  });
});
