/**
 * Mock network-activity feed for the explorer-preview chart.
 *
 * Both channels share a single underlying waveform — when activity peaks
 * IN spikes up and OUT spikes down at the *same* moment, producing the
 * symmetric mirror look from the reference design. Visual feel matters
 * here, not data fidelity.
 */

export interface NetworkSample {
  ts: number;
  inKbps: number;
  outKbps: number;
}

const IN_MAX = 24;
const OUT_MAX = 12;
const IN_AMP = 18;
const OUT_AMP = 9;
const IN_IDLE = 0.6;
const OUT_IDLE = 0.4;

interface WaveLayer {
  freq: number; // radians per step
  phase: number;
  weight: number; // contribution 0..1
  ampMod: { freq: number; phase: number; depth: number } | null;
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

function makeLayers(rng: () => number): WaveLayer[] {
  return [
    // Big slow swell — main visual wave
    {
      freq: 0.045 + rng() * 0.02,
      phase: rng() * Math.PI * 2,
      weight: 0.7,
      ampMod: { freq: 0.018 + rng() * 0.012, phase: rng() * Math.PI * 2, depth: 0.6 },
    },
    // Mid layer adds variation between swells
    {
      freq: 0.13 + rng() * 0.05,
      phase: rng() * Math.PI * 2,
      weight: 0.22,
      ampMod: { freq: 0.04 + rng() * 0.02, phase: rng() * Math.PI * 2, depth: 0.5 },
    },
    // Fast micro layer for surface texture
    {
      freq: 0.42 + rng() * 0.18,
      phase: rng() * Math.PI * 2,
      weight: 0.08,
      ampMod: null,
    },
  ];
}

/**
 * Compute the shared waveform value at step i. Returns a non-negative
 * activity intensity that both channels share — IN scales it up, OUT
 * scales it down (and the chart mirrors OUT below the midline).
 */
function sampleWaveform(layers: WaveLayer[], i: number): number {
  let v = 0;
  for (const l of layers) {
    let w = l.weight;
    if (l.ampMod) {
      const m = Math.sin(i * l.ampMod.freq + l.ampMod.phase);
      w *= 1 - l.ampMod.depth * (0.5 - m * 0.5);
    }
    v += Math.abs(Math.sin(i * l.freq + l.phase)) * w;
  }
  return v; // approximately 0..1
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
  const layers = makeLayers(rng);
  const dt = spanMs / count;

  const samples: NetworkSample[] = [];
  for (let i = 0; i < count; i++) {
    const w = sampleWaveform(layers, i);
    const inJitter = (rng() * 2 - 1) * 1.0;
    const outJitter = (rng() * 2 - 1) * 0.5;
    samples.push({
      ts: endTs - spanMs + i * dt,
      inKbps: clamp(IN_IDLE + w * IN_AMP + inJitter, 0, IN_MAX),
      outKbps: clamp(OUT_IDLE + w * OUT_AMP + outJitter, 0, OUT_MAX),
    });
  }
  return samples;
}

/**
 * Append a single live sample. Driven by wall-clock time so the wave
 * keeps flowing forward; IN and OUT share the same waveform, just
 * scaled differently.
 */
export function nextSample(
  _history: NetworkSample[],
  rng: () => number = Math.random,
): NetworkSample {
  const ts = Date.now();
  const t = ts / 1000;
  const w =
    Math.abs(Math.sin(t * 0.05)) * 0.7 +
    Math.abs(Math.sin(t * 0.18 + 1.3)) * 0.22 +
    Math.abs(Math.sin(t * 0.55 + 0.4)) * 0.08;
  const inJitter = (rng() * 2 - 1) * 1.0;
  const outJitter = (rng() * 2 - 1) * 0.5;
  return {
    ts,
    inKbps: clamp(IN_IDLE + w * IN_AMP + inJitter, 0, IN_MAX),
    outKbps: clamp(OUT_IDLE + w * OUT_AMP + outJitter, 0, OUT_MAX),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
