/**
 * Mock network-activity feed for the explorer-preview chart.
 *
 * Generates broad rolling waves (not point-accurate event data) — both
 * channels rest at the chart's midline and rise outward in big organic
 * swells. The point is visual feel, not data fidelity, so we stack a few
 * oscillators with amplitude modulation rather than simulating individual
 * proof submissions.
 */

export interface NetworkSample {
  ts: number;
  inKbps: number;
  outKbps: number;
}

const IN_MAX = 24;
const OUT_MAX = 12;

interface WaveLayer {
  freq: number; // radians per sample-step
  phase: number;
  amp: number; // peak height contributed by this layer
  ampMod: { freq: number; phase: number; depth: number } | null; // slow amplitude modulation, makes wave heights vary
}

interface Channel {
  ceil: number;
  idle: number;
  layers: WaveLayer[];
  jitter: number;
}

/** Deterministic RNG so SSR + first client paint match. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function makeChannel(
  rng: () => number,
  opts: { ceil: number; idle: number; mainAmp: number; jitter: number },
): Channel {
  return {
    ceil: opts.ceil,
    idle: opts.idle,
    jitter: opts.jitter,
    layers: [
      // Big slow swell — main visual wave
      {
        freq: 0.045 + rng() * 0.02,
        phase: rng() * Math.PI * 2,
        amp: opts.mainAmp,
        ampMod: { freq: 0.018 + rng() * 0.012, phase: rng() * Math.PI * 2, depth: 0.65 },
      },
      // Mid layer for variation between swells
      {
        freq: 0.13 + rng() * 0.05,
        phase: rng() * Math.PI * 2,
        amp: opts.mainAmp * 0.35,
        ampMod: { freq: 0.04 + rng() * 0.02, phase: rng() * Math.PI * 2, depth: 0.5 },
      },
      // Fast micro layer for surface texture
      {
        freq: 0.42 + rng() * 0.18,
        phase: rng() * Math.PI * 2,
        amp: opts.mainAmp * 0.12,
        ampMod: null,
      },
    ],
  };
}

function sampleChannel(ch: Channel, i: number, noise: number): number {
  let v = ch.idle;
  for (const layer of ch.layers) {
    let amp = layer.amp;
    if (layer.ampMod) {
      const m = Math.sin(i * layer.ampMod.freq + layer.ampMod.phase);
      amp *= 1 - layer.ampMod.depth * (0.5 - m * 0.5); // 1 .. (1 - depth)
    }
    // Half-wave rectified: |sin| → wave only adds upward, never below idle.
    v += Math.abs(Math.sin(i * layer.freq + layer.phase)) * amp;
  }
  v += noise * ch.jitter;
  return Math.max(0, Math.min(ch.ceil, v));
}

export function buildHistory({
  count = 220,
  spanMs = 6 * 60 * 60 * 1000,
  endTs = Date.now(),
  seed = 1337,
}: {
  count?: number;
  spanMs?: number;
  endTs?: number;
  seed?: number;
} = {}): NetworkSample[] {
  const rng = mulberry32(seed);
  const inCh = makeChannel(rng, { ceil: IN_MAX, idle: 0.6, mainAmp: 18, jitter: 1.2 });
  const outCh = makeChannel(rng, { ceil: OUT_MAX, idle: 0.4, mainAmp: 9, jitter: 0.7 });
  const dt = spanMs / count;

  const samples: NetworkSample[] = [];
  for (let i = 0; i < count; i++) {
    samples.push({
      ts: endTs - spanMs + i * dt,
      inKbps: sampleChannel(inCh, i, rng() * 2 - 1),
      outKbps: sampleChannel(outCh, i, rng() * 2 - 1),
    });
  }
  return samples;
}

/**
 * Append a single live sample by extending the wave one step further.
 * We don't have the original phase state on hand, so we approximate by
 * sampling fresh wave layers seeded from the wall clock — visually
 * indistinguishable from the seeded history, and avoids needing to
 * thread state through the page.
 */
export function nextSample(history: NetworkSample[], rng: () => number = Math.random): NetworkSample {
  const i = history.length;
  const ts = Date.now();
  const tSec = ts / 1000;

  // Live layers — same shape as makeChannel() but driven by wall-clock
  // time so the wave keeps flowing as time passes.
  const inV = wave(tSec, [
    { freq: 0.18, amp: 18, modFreq: 0.07 },
    { freq: 0.55, amp: 6, modFreq: 0.16 },
    { freq: 1.7, amp: 2.2, modFreq: 0 },
  ]) + 0.6 + (rng() * 2 - 1) * 1.2;
  const outV = wave(tSec, [
    { freq: 0.21, amp: 9, modFreq: 0.08 },
    { freq: 0.6, amp: 3, modFreq: 0.18 },
    { freq: 1.8, amp: 1.1, modFreq: 0 },
  ]) + 0.4 + (rng() * 2 - 1) * 0.7;

  return {
    ts,
    inKbps: clamp(inV, 0, IN_MAX),
    outKbps: clamp(outV, 0, OUT_MAX),
  };
}

function wave(t: number, layers: { freq: number; amp: number; modFreq: number }[]): number {
  let v = 0;
  for (const l of layers) {
    let amp = l.amp;
    if (l.modFreq > 0) amp *= 0.5 + Math.abs(Math.sin(t * l.modFreq * 0.5)) * 0.5;
    v += Math.abs(Math.sin(t * l.freq)) * amp;
  }
  return v;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
