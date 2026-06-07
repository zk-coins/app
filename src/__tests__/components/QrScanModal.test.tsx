/**
 * QrScanModal tests (`src/components/QrScanModal.tsx`).
 *
 * Layered against the lib tests: `decodeQr` is mocked here (its real
 * round-trip behaviour is pinned in `src/__tests__/lib/qr.test.ts`)
 * while `extractRecipient` stays REAL, so the component's accept/reject
 * routing runs the genuine validation. The browser plumbing the
 * happy-dom environment lacks — `getUserMedia`, `<video>` readiness,
 * canvas 2d, `Image` decoding, object URLs — is stubbed per test.
 *
 * Covered:
 *   - camera happy path: stream starts, a frame decodes, `onResult`
 *     fires exactly once with the normalised recipient, tracks stop
 *   - non-recipient payload: invalid-flash appears, auto-clears, and a
 *     later valid frame still resolves the scan
 *   - not-ready video frames are skipped (readyState / dimensions)
 *   - permission denied / no device / generic failure / no
 *     `mediaDevices` at all → the matching error copy, upload intact
 *   - `play()` rejection is benign (Safari kick)
 *   - unmount while `getUserMedia` is in flight stops the late stream
 *   - upload fallback: decode success routes through `onResult`;
 *     QR-free image, non-recipient QR, unreadable file → inline errors
 *   - close affordances: X button, backdrop, Escape (and not on other
 *     keys); panel clicks do not bubble into close
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QrScanModal, SCAN_INTERVAL_MS } from '@/components/QrScanModal';
import { decodeQr } from '@/lib/qr';

vi.mock('@/lib/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/qr')>();
  return { ...actual, decodeQr: vi.fn(() => null) };
});

const decodeQrMock = vi.mocked(decodeQr);

const RECIPIENT = '1a2b3c4d@dev.zkcoins.app';

/** A minimal MediaStream stand-in with spy-able tracks. */
function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
}

/** Install a controllable `navigator.mediaDevices.getUserMedia`. */
function stubGetUserMedia(impl: () => Promise<MediaStream>) {
  const getUserMedia = vi.fn(impl);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  return getUserMedia;
}

function removeMediaDevices() {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: undefined,
    configurable: true,
  });
}

/**
 * happy-dom rejects `video.srcObject = <plain object>` (it validates the
 * MediaStream type) and has no real `play()`. Replace both on the
 * prototype so the component's stream-attach path runs without a real
 * camera. `playImpl` lets a test force a `play()` rejection.
 */
function allowVideo(playImpl?: () => Promise<void>) {
  vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
    playImpl ?? (() => Promise.resolve()),
  );
}

/** Fake 2d context — `getImageData` returns a 1×1 frame; decode is mocked. */
function stubCanvas() {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  return ctx;
}

/** Mark the rendered <video> as playing a real frame. */
function makeVideoReady(overrides: Partial<Record<string, number>> = {}) {
  const video = screen.getByTestId('qr-scan-video') as HTMLVideoElement;
  Object.defineProperty(video, 'readyState', {
    value: overrides.readyState ?? 4,
    configurable: true,
  });
  Object.defineProperty(video, 'videoWidth', {
    value: overrides.videoWidth ?? 640,
    configurable: true,
  });
  Object.defineProperty(video, 'videoHeight', {
    value: overrides.videoHeight ?? 480,
    configurable: true,
  });
  return video;
}

/** Render with a stream resolving under our control; flush start(). */
async function renderScanning(opts: { onResult?: (r: string) => void; onClose?: () => void } = {}) {
  const { stream, stop } = fakeStream();
  let resolveStream!: (s: MediaStream) => void;
  stubGetUserMedia(() => new Promise<MediaStream>((r) => (resolveStream = r)));
  stubCanvas();
  allowVideo();

  const onResult = opts.onResult ?? vi.fn();
  const onClose = opts.onClose ?? vi.fn();
  const utils = render(<QrScanModal onResult={onResult} onClose={onClose} />);

  makeVideoReady();
  await act(async () => {
    resolveStream(stream);
    await Promise.resolve();
  });
  return { ...utils, onResult, onClose, stop };
}

beforeEach(() => {
  decodeQrMock.mockReset();
  decodeQrMock.mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('QrScanModal — camera scanning', () => {
  it('decodes a frame and resolves the scan exactly once', async () => {
    vi.useFakeTimers();
    const { onResult, stop } = await renderScanning();

    expect(screen.queryByTestId('qr-scan-starting')).not.toBeInTheDocument();
    decodeQrMock.mockReturnValue(RECIPIENT);
    await act(async () => {
      vi.advanceTimersByTime(SCAN_INTERVAL_MS * 2);
    });

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(RECIPIENT);
    expect(stop).toHaveBeenCalled();
  });

  it('unwraps a zkcoins: scheme through the real extractRecipient', async () => {
    vi.useFakeTimers();
    const { onResult } = await renderScanning();

    decodeQrMock.mockReturnValue(`zkcoins:${RECIPIENT}`);
    await act(async () => {
      vi.advanceTimersByTime(SCAN_INTERVAL_MS);
    });

    expect(onResult).toHaveBeenCalledWith(RECIPIENT);
  });

  it('flashes on a non-recipient payload, clears, then accepts a valid frame', async () => {
    vi.useFakeTimers();
    const { onResult } = await renderScanning();

    decodeQrMock.mockReturnValue('https://example.com/junk');
    await act(async () => {
      vi.advanceTimersByTime(SCAN_INTERVAL_MS);
    });
    expect(screen.getByTestId('qr-scan-invalid')).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();

    // A second junk frame re-arms the flash timer (clearTimeout branch).
    await act(async () => {
      vi.advanceTimersByTime(SCAN_INTERVAL_MS);
    });
    expect(screen.getByTestId('qr-scan-invalid')).toBeInTheDocument();

    // Stop producing frames; the flash auto-clears after 2 s.
    decodeQrMock.mockReturnValue(null);
    await act(async () => {
      vi.advanceTimersByTime(2_100);
    });
    expect(screen.queryByTestId('qr-scan-invalid')).not.toBeInTheDocument();

    decodeQrMock.mockReturnValue(RECIPIENT);
    await act(async () => {
      vi.advanceTimersByTime(SCAN_INTERVAL_MS);
    });
    expect(onResult).toHaveBeenCalledWith(RECIPIENT);
  });

  it('skips frames while the video is not ready', async () => {
    vi.useFakeTimers();
    await renderScanning();

    makeVideoReady({ readyState: 1 });
    await act(async () => {
      vi.advanceTimersByTime(SCAN_INTERVAL_MS);
    });
    expect(decodeQrMock).not.toHaveBeenCalled();

    makeVideoReady({ readyState: 4, videoWidth: 0 });
    await act(async () => {
      vi.advanceTimersByTime(SCAN_INTERVAL_MS);
    });
    expect(decodeQrMock).not.toHaveBeenCalled();

    makeVideoReady({ videoHeight: 0 });
    await act(async () => {
      vi.advanceTimersByTime(SCAN_INTERVAL_MS);
    });
    expect(decodeQrMock).not.toHaveBeenCalled();

    makeVideoReady();
    await act(async () => {
      vi.advanceTimersByTime(SCAN_INTERVAL_MS);
    });
    expect(decodeQrMock).toHaveBeenCalled();
  });

  it('keeps scanning when play() rejects (Safari kick is best-effort)', async () => {
    const { stream } = fakeStream();
    stubGetUserMedia(() => Promise.resolve(stream));
    stubCanvas();
    allowVideo(() => Promise.reject(new Error('NotAllowedError')));
    render(<QrScanModal onResult={vi.fn()} onClose={vi.fn()} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByTestId('qr-scan-camera-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('qr-scan-starting')).not.toBeInTheDocument();
  });

  it('stops a stream that resolves after unmount', async () => {
    const { stream, stop } = fakeStream();
    let resolveStream!: (s: MediaStream) => void;
    stubGetUserMedia(() => new Promise<MediaStream>((r) => (resolveStream = r)));
    stubCanvas();

    const { unmount } = render(<QrScanModal onResult={vi.fn()} onClose={vi.fn()} />);
    unmount();
    await act(async () => {
      resolveStream(stream);
      await Promise.resolve();
    });

    expect(stop).toHaveBeenCalled();
  });
});

describe('QrScanModal — camera unavailable', () => {
  it.each([
    ['NotAllowedError', /Camera access was denied/],
    ['NotFoundError', /No camera was found/],
    ['WeirdError', /The camera is unavailable/],
  ])('shows the matching copy for %s', async (name, copy) => {
    const err = new Error(name);
    err.name = name;
    stubGetUserMedia(() => Promise.reject(err));

    render(<QrScanModal onResult={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('qr-scan-camera-error')).toHaveTextContent(copy);
    // The upload fallback stays available.
    expect(screen.getByTestId('qr-scan-upload-btn')).toBeInTheDocument();
  });

  it('falls back to the generic copy for a non-Error rejection', async () => {
    stubGetUserMedia(() => Promise.reject('boom'));

    render(<QrScanModal onResult={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('qr-scan-camera-error')).toHaveTextContent(
      /The camera is unavailable/,
    );
  });

  it('ignores a getUserMedia rejection that arrives after unmount', async () => {
    let rejectStream!: (e: unknown) => void;
    stubGetUserMedia(() => new Promise<MediaStream>((_, rej) => (rejectStream = rej)));

    const { unmount } = render(<QrScanModal onResult={vi.fn()} onClose={vi.fn()} />);
    unmount();
    await act(async () => {
      rejectStream(new Error('NotAllowedError'));
      await Promise.resolve();
    });

    // No error UI to assert (the modal is gone); the test pins that the
    // post-unmount catch branch does not touch React state.
    expect(screen.queryByTestId('qr-scan-camera-error')).not.toBeInTheDocument();
  });

  it('shows unsupported-browser copy when mediaDevices is absent', async () => {
    removeMediaDevices();

    render(<QrScanModal onResult={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('qr-scan-camera-error')).toHaveTextContent(
      /does not support camera access/,
    );
  });
});

describe('QrScanModal — upload fallback', () => {
  /** Install an Image stub whose load outcome we control. */
  function stubImage(outcome: 'load' | 'error') {
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 100;
        naturalHeight = 100;
        set src(_v: string) {
          queueMicrotask(() => (outcome === 'load' ? this.onload?.() : this.onerror?.()));
        }
      },
    );
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', { value: () => '', configurable: true });
      Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true });
    }
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  }

  async function uploadFile() {
    const input = screen.getByTestId('qr-scan-file-input');
    const file = new File(['png-bytes'], 'qr.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
    });
  }

  async function setup() {
    // Camera permanently pending — upload must work independently of it.
    stubGetUserMedia(() => new Promise<MediaStream>(() => {}));
    const ctx = stubCanvas();
    const onResult = vi.fn();
    render(<QrScanModal onResult={onResult} onClose={vi.fn()} />);
    return { ctx, onResult };
  }

  it('decodes an uploaded QR image and resolves the scan', async () => {
    const { onResult } = await setup();
    stubImage('load');
    decodeQrMock.mockReturnValue(RECIPIENT);

    fireEvent.click(screen.getByTestId('qr-scan-upload-btn'));
    await uploadFile();

    expect(onResult).toHaveBeenCalledWith(RECIPIENT);
  });

  it('reports an image without any QR code', async () => {
    const { onResult } = await setup();
    stubImage('load');
    decodeQrMock.mockReturnValue(null);

    await uploadFile();

    expect(screen.getByTestId('qr-scan-file-error')).toHaveTextContent(/No QR code was found/);
    expect(onResult).not.toHaveBeenCalled();
  });

  it('reports a QR code that is not a zkCoins address', async () => {
    const { onResult } = await setup();
    stubImage('load');
    decodeQrMock.mockReturnValue('https://example.com/junk');

    await uploadFile();

    expect(screen.getByTestId('qr-scan-file-error')).toHaveTextContent(/not a zkCoins address/);
    expect(onResult).not.toHaveBeenCalled();
  });

  it('reports an unreadable file', async () => {
    await setup();
    stubImage('error');

    await uploadFile();

    expect(screen.getByTestId('qr-scan-file-error')).toHaveTextContent(/could not be read/);
  });

  it('ignores an empty file selection', async () => {
    const { onResult } = await setup();
    stubImage('load');

    const input = screen.getByTestId('qr-scan-file-input');
    await act(async () => {
      fireEvent.change(input, { target: { files: [] } });
      await Promise.resolve();
    });

    expect(onResult).not.toHaveBeenCalled();
    expect(screen.queryByTestId('qr-scan-file-error')).not.toBeInTheDocument();
  });
});

describe('QrScanModal — close affordances', () => {
  async function setup() {
    stubGetUserMedia(() => new Promise<MediaStream>(() => {}));
    stubCanvas();
    const onClose = vi.fn();
    render(<QrScanModal onResult={vi.fn()} onClose={onClose} />);
    return { onClose };
  }

  it('closes via the X button', async () => {
    const { onClose } = await setup();
    fireEvent.click(screen.getByTestId('qr-scan-close-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via the backdrop but not via the panel', async () => {
    const { onClose } = await setup();
    fireEvent.click(screen.getByRole('heading', { name: 'Scan QR code' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('qr-scan-modal'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and ignores other keys', async () => {
    const { onClose } = await setup();
    fireEvent.keyDown(window, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
