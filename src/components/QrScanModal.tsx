'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraOff, Upload, X } from 'lucide-react';
import { decodeQr, extractRecipient } from '@/lib/qr';

/**
 * Full-screen scanner overlay for the Send screen. Opens the camera via
 * `getUserMedia`, samples frames onto a hidden canvas every
 * `SCAN_INTERVAL_MS`, and decodes them with `decodeQr` (jsQR). The first
 * frame whose payload normalises to a plausible recipient (see
 * `extractRecipient` in `lib/qr.ts`) resolves the scan: the stream is
 * torn down and `onResult` fires with the recipient string.
 *
 * Fallback: an image-upload path (hidden file input + button) decodes a
 * still photo of a QR code through the same primitive. It is always
 * offered — it is the only path when the browser has no `getUserMedia`
 * or the user denied camera access.
 *
 * Render-only by design: every decision about what a payload means lives
 * in `lib/qr.ts` (unit-tested to 100 %); this component owns only the
 * browser plumbing (stream lifecycle, frame sampling, file reading) and
 * the overlay UI.
 */

export const SCAN_INTERVAL_MS = 200;
/** How long the "not a zkCoins address" flash stays up between frames. */
const INVALID_FLASH_MS = 2000;

type CameraState = 'starting' | 'scanning' | 'error';

interface QrScanModalProps {
  /** Fires once with the normalised recipient; the modal tears down first. */
  onResult: (recipient: string) => void;
  /** Fires when the user dismisses the scanner (X, backdrop, Escape). */
  onClose: () => void;
}

/** Map a getUserMedia rejection to user-facing copy. */
function cameraErrorCopy(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera access was denied. Allow camera access in your browser settings, or upload an image of the QR code instead.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device. Upload an image of the QR code instead.';
  }
  return 'The camera is unavailable. Upload an image of the QR code instead.';
}

export function QrScanModal({ onResult, onClose }: QrScanModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false);

  const [camera, setCamera] = useState<CameraState>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [invalidPayload, setInvalidPayload] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const invalidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  /** Resolve the scan exactly once: tear down, then hand the result up. */
  const finish = useCallback(
    (recipient: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      stopStream();
      onResult(recipient);
    },
    [onResult, stopStream],
  );

  /** Route a decoded payload: finish on a recipient, flash on junk. */
  const handlePayload = useCallback(
    (payload: string): boolean => {
      const recipient = extractRecipient(payload);
      if (recipient) {
        finish(recipient);
        return true;
      }
      setInvalidPayload(true);
      if (invalidTimerRef.current) clearTimeout(invalidTimerRef.current);
      invalidTimerRef.current = setTimeout(() => setInvalidPayload(false), INVALID_FLASH_MS);
      return false;
    },
    [finish],
  );

  // Camera lifecycle: request the stream on mount, sample frames on an
  // interval, tear everything down on unmount. An interval (not rAF) so
  // backgrounded tabs keep a predictable cadence and tests can drive the
  // loop with fake timers.
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const scanTick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      /* c8 ignore next — refs are always mounted while the interval runs */
      if (!video || !canvas) return;
      // HAVE_CURRENT_DATA (2) — the first real frame is available.
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      /* c8 ignore next — canvas 2d is universal in scan-capable browsers */
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const payload = decodeQr(frame.data, frame.width, frame.height);
      if (payload) handlePayload(payload);
    };

    const start = async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCamera('error');
        setCameraError(
          'This browser does not support camera access. Upload an image of the QR code instead.',
        );
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        /* c8 ignore next — the video element is mounted before start() resolves */
        if (!video) return;
        video.srcObject = stream;
        // Safari needs the explicit play() kick; rejections (e.g. the
        // modal closing mid-start) are benign because teardown follows.
        await video.play().catch(() => {});
        setCamera('scanning');
        interval = setInterval(scanTick, SCAN_INTERVAL_MS);
      } catch (err) {
        if (!cancelled) {
          setCamera('error');
          setCameraError(cameraErrorCopy(err));
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (invalidTimerRef.current) clearTimeout(invalidTimerRef.current);
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes the scanner, mirroring the backdrop and X affordances.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Allow re-selecting the same file after a failed attempt.
      e.target.value = '';
      if (!file) return;
      setFileError(null);

      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = canvasRef.current;
        /* c8 ignore next — the canvas is always mounted with the modal */
        if (!canvas) return;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        /* c8 ignore next — canvas 2d is universal in scan-capable browsers */
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const payload = decodeQr(frame.data, frame.width, frame.height);
        if (!payload) {
          setFileError('No QR code was found in that image.');
          return;
        }
        if (!handlePayload(payload)) {
          setFileError('That QR code is not a zkCoins address.');
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        setFileError('That file could not be read as an image.');
      };
      img.src = url;
    },
    [handlePayload],
  );

  return (
    <div
      data-testid="qr-scan-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Scan QR code"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        // Close only on a genuine backdrop click — clicks that bubble up
        // from the panel keep the scanner open.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-md border border-line2 bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">Scan QR code</h2>
          <button
            type="button"
            data-testid="qr-scan-close-btn"
            aria-label="Close scanner"
            onClick={onClose}
            className="rounded-md p-1 text-ink3 transition-colors hover:text-ink"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {camera === 'error' ? (
          <div
            data-testid="qr-scan-camera-error"
            className="mt-4 flex flex-col items-center gap-3 rounded-md border border-line bg-bg px-4 py-8 text-center"
          >
            <CameraOff size={28} strokeWidth={1.75} className="text-ink4" />
            <p className="text-[12px] leading-relaxed text-ink2">{cameraError}</p>
          </div>
        ) : (
          <div className="mt-4">
            <div className="relative aspect-square overflow-hidden rounded-md border border-line bg-black">
              <video
                ref={videoRef}
                data-testid="qr-scan-video"
                muted
                playsInline
                className="h-full w-full object-cover"
              />
              {camera === 'starting' && (
                <p
                  data-testid="qr-scan-starting"
                  className="absolute inset-0 flex items-center justify-center text-[12px] text-ink3"
                >
                  Starting camera…
                </p>
              )}
            </div>
            <p className="mt-2 text-center text-[11px] text-ink3">
              Point the camera at a zkCoins address QR code.
            </p>
          </div>
        )}

        {invalidPayload && (
          <p data-testid="qr-scan-invalid" className="mt-3 text-center text-[12px] text-bad">
            That QR code is not a zkCoins address.
          </p>
        )}

        <div className="mt-4 border-t border-line pt-4">
          <button
            type="button"
            data-testid="qr-scan-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-line2 py-3 text-[13px] font-semibold tracking-tight text-ink transition-colors hover:border-bitcoin hover:text-bitcoin"
          >
            <Upload size={15} strokeWidth={2} />
            Upload image
          </button>
          <input
            ref={fileInputRef}
            data-testid="qr-scan-file-input"
            type="file"
            accept="image/*"
            onChange={onFileChange}
            className="hidden"
          />
          {fileError && (
            <p data-testid="qr-scan-file-error" className="mt-2 text-center text-[12px] text-bad">
              {fileError}
            </p>
          )}
        </div>
      </div>

      {/* Offscreen scratch canvas for frame sampling — never displayed. */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
