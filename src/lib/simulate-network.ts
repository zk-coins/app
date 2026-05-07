/**
 * Mock network-activity feed used until the real zkCoins explorer API exists.
 *
 * Both channels rest near zero (i.e. at the chart's midline) and produce
 * sharp gaussian-shaped spikes outward — IN renders upward, OUT renders
 * mirrored downward. The result reads as a waveform of bursts of traffic
 * over an otherwise quiet network, not as a steady mid-amplitude line.
 */

export interface NetworkSample {
  ts: number;
  inKbps: number;
  outKbps: number;
}

const IN_MAX = 24;
const OUT_MAX = 12;

interface Spike {
  at: number; // 0..1, position along the window
  width: number; // gaussian σ
  amp: number;
}

interface Channel {
  ceil: number;
  /** small idle-noise baseline so the line breathes a touch */
  idle: number;
  spikes: Spike[];
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

function makeChannel(rng: () => number, opts: { ceil: number; idle: number; spikeCount: number; spikeAmpRange: [number, number]; widthRange: [number, number] }): Channel {
  const spikes: Spike[] = [];
  for (let i = 0; i < opts.spikeCount; i++) {
    spikes.push({
      at: rng(),
      width: opts.widthRange[0] + rng() * (opts.widthRange[1] - opts.widthRange[0]),
      amp: opts.spikeAmpRange[0] + rng() * (opts.spikeAmpRange[1] - opts.spikeAmpRange[0]),
    });
  }
  return { ceil: opts.ceil, idle: opts.idle, spikes };
}

function sampleChannel(ch: Channel, frac: number, noise: number): number {
  let v = ch.idle + noise * ch.idle * 1.4; // micro-wobble around idle floor
  for (const s of ch.spikes) {
    const d = (frac - s.at) / s.width;
    if (Math.abs(d) < 3) v += s.amp * Math.exp(-d * d);
  }
  return Math.max(0, Math.min(ch.ceil, v));
}

export function buildHistory({
  count = 220,
  spanMs = 60 * 60 * 1000,
  endTs = Date.now(),
  seed = 1337,
}: {
  count?: number;
  spanMs?: number;
  endTs?: number;
  seed?: number;
} = {}): NetworkSample[] {
  const rng = mulberry32(seed);
  const inCh = makeChannel(rng, {
    ceil: IN_MAX,
    idle: 1.2,
    spikeCount: 14,
    spikeAmpRange: [12, 22],
    widthRange: [0.006, 0.02],
  });
  const outCh = makeChannel(rng, {
    ceil: OUT_MAX,
    idle: 0.6,
    spikeCount: 16,
    spikeAmpRange: [6, 11],
    widthRange: [0.005, 0.018],
  });
  const dt = spanMs / count;

  const samples: NetworkSample[] = [];
  for (let i = 0; i < count; i++) {
    const ts = endTs - spanMs + i * dt;
    const frac = i / (count - 1);
    samples.push({
      ts,
      inKbps: sampleChannel(inCh, frac, rng() * 2 - 1),
      outKbps: sampleChannel(outCh, frac, rng() * 2 - 1),
    });
  }
  return samples;
}

/**
 * Append a single live sample. New events are pure spikes on top of the
 * idle floor — no drift toward a non-zero average — so the line keeps
 * returning to the midline between bursts.
 */
export function nextSample(_history: NetworkSample[], rng: () => number = Math.random): NetworkSample {
  const idleIn = 1.2 + (rng() - 0.5) * 0.6;
  const idleOut = 0.6 + (rng() - 0.5) * 0.4;
  const burstIn = rng() < 0.18 ? 8 + rng() * 14 : 0;
  const burstOut = rng() < 0.22 ? 4 + rng() * 7 : 0;
  return {
    ts: Date.now(),
    inKbps: clamp(idleIn + burstIn, 0, IN_MAX),
    outKbps: clamp(idleOut + burstOut, 0, OUT_MAX),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
