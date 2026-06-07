#!/usr/bin/env node
/**
 * Generate the deterministic QR fixtures the Send-scan E2E spec
 * (`e2e/15-send-scan-qr.spec.ts`) feeds to Chromium:
 *
 *   e2e/_fixtures/qr-scan.y4m — a single-frame YUV4MPEG2 clip of a QR
 *     code, played into the browser via Chromium's
 *     `--use-file-for-fake-video-capture`. The flag loops the clip, so
 *     one frame is a static QR held in front of the fake camera — the
 *     faithful, reproducible stand-in for a phone showing a QR.
 *
 *   e2e/_fixtures/qr-scan.png — the same payload as a still image, for
 *     the upload-fallback path (`<input type="file">`).
 *
 * Pure Node — no ffmpeg. The QR matrix comes from the `qrcode` package
 * (already a devDependency); we rasterise it to a luminance buffer and
 * wrap it as I420 (Y plane = luminance, U/V planes = neutral 128).
 *
 * Re-run after changing the payload:  node scripts/make-qr-y4m.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'e2e', '_fixtures');

// Kept in sync with `PAYLOAD` in e2e/15-send-scan-qr.spec.ts. The
// Receive screen encodes exactly this `<handle>@<domain>` shape
// (see `toZkAddress` in src/lib/format.ts), so scanning it round-trips.
const PAYLOAD = '1a2b3c4d@dev.zkcoins.app';

// Frame size. Even dimensions are required for I420 chroma subsampling.
const DIM = 320;

/** Rasterise the QR for `text` to a `DIM`×`DIM` 8-bit luminance buffer. */
function rasterizeLuma(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const quiet = 4;
  const scale = Math.floor(DIM / (size + quiet * 2));
  if (scale < 1) throw new Error(`payload too large to fit ${DIM}px at quiet zone ${quiet}`);
  const qrPixels = (size + quiet * 2) * scale;
  const offset = Math.floor((DIM - qrPixels) / 2);

  // White background (255). Stamp black (0) modules, centred.
  const luma = new Uint8Array(DIM * DIM).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!qr.modules.data[y * size + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const py = offset + (y + quiet) * scale + dy;
          const px = offset + (x + quiet) * scale + dx;
          luma[py * DIM + px] = 0;
        }
      }
    }
  }
  return luma;
}

/** Wrap a luminance buffer as a single-frame YUV4MPEG2 (I420) byte array. */
function toY4m(luma) {
  const header = Buffer.from(`YUV4MPEG2 W${DIM} H${DIM} F15:1 Ip A1:1 C420jpeg\n`, 'ascii');
  const frameMarker = Buffer.from('FRAME\n', 'ascii');
  const yPlane = Buffer.from(luma); // full-res luminance
  // Neutral chroma → greyscale. Quarter-res U and V planes.
  const chromaLen = (DIM / 2) * (DIM / 2);
  const uPlane = Buffer.alloc(chromaLen, 128);
  const vPlane = Buffer.alloc(chromaLen, 128);
  return Buffer.concat([header, frameMarker, yPlane, uPlane, vPlane]);
}

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true });

  const luma = rasterizeLuma(PAYLOAD);
  const y4mPath = join(FIXTURES_DIR, 'qr-scan.y4m');
  await writeFile(y4mPath, toY4m(luma));

  const pngPath = join(FIXTURES_DIR, 'qr-scan.png');
  await QRCode.toFile(pngPath, PAYLOAD, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: DIM,
  });

  // eslint-disable-next-line no-console
  console.log(`wrote ${y4mPath}\nwrote ${pngPath}\npayload: ${PAYLOAD}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
