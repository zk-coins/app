'use client';

import { useMemo } from 'react';
import type { NetworkSample } from '@/lib/simulate-network';

interface Props {
  samples: NetworkSample[];
  className?: string;
}

const W = 800;
const H = 340;
const PAD = { top: 18, right: 24, bottom: 24, left: 72 };
const CHART_W = W - PAD.left - PAD.right;
const CHART_H = H - PAD.top - PAD.bottom;
const Y_MID = PAD.top + CHART_H / 2;

const IN_MAX = 24; // upper-half scale (0 → 24 KB/s)
const OUT_MAX = 12; // lower-half scale, mirrored downward

export function NetworkActivity({ samples, className }: Props) {
  const { inPath, outPath, inArea, outArea } = useMemo(() => buildPaths(samples), [samples]);
  const last = samples[samples.length - 1];
  const currentIn = last?.inKbps ?? 0;
  const currentOut = last?.outKbps ?? 0;

  return (
    <div
      className={`rounded-xl border border-line2 bg-surface p-5 ${className ?? ''}`}
      role="img"
      aria-label="Network activity chart"
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <p className="mono text-[12px] font-semibold tracking-[0.25em] text-ink uppercase">
          Network activity
        </p>
        <div className="flex items-center gap-5 mono text-[11px] tracking-[0.2em] text-ink uppercase">
          <span className="flex items-center gap-2">
            <span className="block h-[3px] w-3.5 bg-bitcoin" />
            IN
          </span>
          <span className="flex items-center gap-2">
            <span className="block h-[3px] w-3.5 bg-ink2" />
            OUT
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="netact-in" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f7931a" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#f7931a" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="netact-out" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#d4d4d8" stopOpacity="0.40" />
            <stop offset="100%" stopColor="#d4d4d8" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y-axis labels */}
        <g className="mono" fill="#a1a1aa" fontSize="12" letterSpacing="1">
          <text x={PAD.left - 12} y={PAD.top + 4} textAnchor="end">24 MB/s</text>
          <text x={PAD.left - 12} y={Y_MID + 4} textAnchor="end">12 MB/s</text>
          <text x={PAD.left - 12} y={PAD.top + CHART_H + 4} textAnchor="end">0 MB/s</text>
        </g>

        {/* Dashed grid */}
        <g stroke="#262626" strokeDasharray="4 6">
          {gridYs().map((y, i) => (
            <line key={`gy-${i}`} x1={PAD.left} x2={PAD.left + CHART_W} y1={y} y2={y} />
          ))}
          {gridXs().map((x, i) => (
            <line key={`gx-${i}`} x1={x} x2={x} y1={PAD.top} y2={PAD.top + CHART_H} />
          ))}
        </g>

        {/* Center baseline (12 MB/s) */}
        <line x1={PAD.left} x2={PAD.left + CHART_W} y1={Y_MID} y2={Y_MID} stroke="#3f3f46" />

        {/* OUT — mirrored below midline, drawn first so IN sits on top visually */}
        <path d={outArea} fill="url(#netact-out)" />
        <path d={outPath} fill="none" stroke="#e4e4e7" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* IN — above midline */}
        <path d={inArea} fill="url(#netact-in)" />
        <path d={inPath} fill="none" stroke="#f7931a" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
      </svg>

      {/* Live readouts */}
      <div className="mt-5 grid grid-cols-2 gap-4">
        <Readout color="#f7931a" value={currentIn} />
        <Readout color="#a1a1aa" value={currentOut} />
      </div>
    </div>
  );
}

function Readout({ color, value }: { color: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
      <span className="mono text-[14px] tabular-nums text-ink">
        {value.toFixed(1)} KB/s
      </span>
    </div>
  );
}

function gridYs(): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 4; i++) out.push(PAD.top + (CHART_H / 4) * i);
  return out;
}

function gridXs(): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 6; i++) out.push(PAD.left + (CHART_W / 6) * i);
  return out;
}

function buildPaths(samples: NetworkSample[]): {
  inPath: string;
  outPath: string;
  inArea: string;
  outArea: string;
} {
  if (samples.length < 2) {
    return { inPath: '', outPath: '', inArea: '', outArea: '' };
  }

  const xOf = (i: number) => PAD.left + (i / (samples.length - 1)) * CHART_W;

  // IN occupies the upper half (midline → top)
  const yIn = (v: number) => Y_MID - (Math.min(v, IN_MAX) / IN_MAX) * (CHART_H / 2);
  // OUT mirrored downward (midline → bottom). Larger out values go further down.
  const yOut = (v: number) => Y_MID + (Math.min(v, OUT_MAX) / OUT_MAX) * (CHART_H / 2);

  const inPts = samples.map((s, i) => ({ x: xOf(i), y: yIn(s.inKbps) }));
  const outPts = samples.map((s, i) => ({ x: xOf(i), y: yOut(s.outKbps) }));

  const inLine = catmullRomToBezier(inPts);
  const outLine = catmullRomToBezier(outPts);

  const inArea = `${inLine} L ${PAD.left + CHART_W} ${Y_MID} L ${PAD.left} ${Y_MID} Z`;
  const outArea = `${outLine} L ${PAD.left + CHART_W} ${Y_MID} L ${PAD.left} ${Y_MID} Z`;

  return { inPath: inLine, outPath: outLine, inArea, outArea };
}

/**
 * Convert a sequence of points into a smooth path using Catmull-Rom-to-Bezier.
 * Tension = 0.5 gives natural-looking curves without overshoot.
 */
function catmullRomToBezier(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  const segs: string[] = [`M ${points[0].x} ${points[0].y}`];
  const t = 0.5;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const cp1x = p1.x + ((p2.x - p0.x) / 6) * t;
    const cp1y = p1.y + ((p2.y - p0.y) / 6) * t;
    const cp2x = p2.x - ((p3.x - p1.x) / 6) * t;
    const cp2y = p2.y - ((p3.y - p1.y) / 6) * t;

    segs.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`);
  }
  return segs.join(' ');
}
