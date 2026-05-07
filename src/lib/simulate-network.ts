/**
 * Mock network-activity feed used until the real zkCoins explorer API exists.
 *
 * Produces a stream of { ts, inKbps, outKbps } samples styled as a
 * "waveform" — multiple oscillators mixed with noise and burst events,
 * so the chart reads as live network throughput rather than a calm walk.
 */

export interface NetworkSample {
  ts: number;
  inKbps: number;
  outKbps: number;
}

const IN_MAX = 24;
const OUT_MAX = 12;

interface Channel {
  baseline: number;
  amplitude: number;
  ceil: number;
  oscillators: { freq: number; amp: number; phase: number }[];
  spikes: { at: number; width: number; amp: number }[];
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

function makeChannel(rng: () => number, opts: { baseline: number; amplitude: number; ceil: number; spikeCount: number }): Channel {
  const oscillators = [
    { freq: 0.03 + rng() * 0.02, amp: opts.amplitude * 0.45, phase: rng() * Math.PI * 2 }, // slow swell
    { freq: 0.12 + rng() * 0.05, amp: opts.amplitude * 0.30, phase: rng() * Math.PI * 2 }, // mid breathing
    { freq: 0.32 + rng() * 0.12, amp: opts.amplitude * 0.18, phase: rng() * Math.PI * 2 }, // fast wiggle
    { freq: 0.7 + rng() * 0.4, amp: opts.amplitude * 0.10, phase: rng() * Math.PI * 2 }, // micro
  ];
  const spikes: { at: number; width: number; amp: number }[] = [];
  for (let i = 0; i < opts.spikeCount; i++) {
    spikes.push({
      at: rng(), // 0..1, fraction along the window
      width: 0.005 + rng() * 0.02,
      amp: opts.amplitude * (0.6 + rng() * 0.6),
    });
  }
  return { ...opts, oscillators, spikes };
}

function sampleChannel(ch: Channel, frac: number, t: number, noise: number): number {
  let v = ch.baseline;
  for (const o of ch.oscillators) v += Math.sin(t * o.freq + o.phase) * o.amp;
  for (const s of ch.spikes) {
    const d = (frac - s.at) / s.width;
    if (Math.abs(d) < 3) v += s.amp * Math.exp(-d * d); // gaussian bump
  }
  v += noise * ch.amplitude * 0.18;
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
  const inCh = makeChannel(rng, { baseline: 14, amplitude: 10, ceil: IN_MAX, spikeCount: 8 });
  const outCh = makeChannel(rng, { baseline: 5.5, amplitude: 5.5, ceil: OUT_MAX, spikeCount: 10 });
  const dt = spanMs / count;

  const samples: NetworkSample[] = [];
  for (let i = 0; i < count; i++) {
    const ts = endTs - spanMs + i * dt;
    const frac = i / (count - 1);
    const inKbps = sampleChannel(inCh, frac, i, rng() * 2 - 1);
    const outKbps = sampleChannel(outCh, frac, i, rng() * 2 - 1);
    samples.push({ ts, inKbps, outKbps });
  }
  return samples;
}

/**
 * Append a single live sample on top of an existing history. The new sample
 * is anchored to the trailing average so the chart breathes naturally rather
 * than jumping.
 */
export function nextSample(history: NetworkSample[], rng: () => number = Math.random): NetworkSample {
  const tail = history.slice(-6);
  const avgIn = tail.reduce((a, s) => a + s.inKbps, 0) / Math.max(1, tail.length);
  const avgOut = tail.reduce((a, s) => a + s.outKbps, 0) / Math.max(1, tail.length);

  // Local oscillation around the average + occasional burst.
  const inWobble = (rng() - 0.5) * 4 + Math.sin(Date.now() / 800) * 1.5;
  const outWobble = (rng() - 0.5) * 3 + Math.sin(Date.now() / 600 + 1) * 1.2;
  const burstIn = rng() < 0.1 ? 4 + rng() * 5 : 0;
  const burstOut = rng() < 0.12 ? 3 + rng() * 4 : 0;

  return {
    ts: Date.now(),
    inKbps: clamp(avgIn + inWobble + burstIn, 2, IN_MAX),
    outKbps: clamp(avgOut + outWobble + burstOut, 0, OUT_MAX),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
