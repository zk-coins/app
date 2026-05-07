/**
 * Mock network-activity feed used until the real zkCoins explorer API exists.
 *
 * Produces a stream of { ts, inKbps, outKbps } samples that look organic:
 * - smooth random walk around a baseline
 * - occasional bursts (proof submissions / state broadcasts)
 * - IN tends to run hotter than OUT (proofs are larger than acks)
 */

export interface NetworkSample {
  ts: number;
  inKbps: number;
  outKbps: number;
}

interface WalkState {
  value: number;
  baseline: number;
  ceil: number;
  burstUntil: number;
  burstAmp: number;
}

function step(rng: () => number, s: WalkState, now: number): number {
  // Drift toward baseline + small gaussian-ish wobble.
  const noise = (rng() - 0.5) * 1.2;
  const drift = (s.baseline - s.value) * 0.12;
  s.value += drift + noise;

  // Occasionally schedule a burst (peak of activity for a few samples).
  if (now > s.burstUntil && rng() < 0.04) {
    s.burstUntil = now + 1000 + rng() * 4000;
    s.burstAmp = (s.ceil - s.baseline) * (0.5 + rng() * 0.6);
  }

  if (now < s.burstUntil) {
    // Add a smooth bell-like contribution while a burst is active.
    const remaining = (s.burstUntil - now) / 5000;
    s.value += s.burstAmp * Math.max(0, Math.min(1, remaining)) * 0.4;
  }

  return Math.max(0, Math.min(s.ceil, s.value));
}

/**
 * Deterministic RNG so charts look the same on the server and the first
 * client paint (no hydration mismatch).
 */
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

export function buildHistory({
  count = 200,
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
  const inState: WalkState = { value: 12, baseline: 12, ceil: 24, burstUntil: 0, burstAmp: 0 };
  const outState: WalkState = { value: 6, baseline: 6, ceil: 12, burstUntil: 0, burstAmp: 0 };
  const dt = spanMs / count;

  const samples: NetworkSample[] = [];
  for (let i = 0; i < count; i++) {
    const ts = endTs - spanMs + i * dt;
    const inKbps = step(rng, inState, ts);
    const outKbps = step(rng, outState, ts);
    samples.push({ ts, inKbps, outKbps });
  }
  return samples;
}

/**
 * Append a single live sample on top of an existing history. Used by the
 * page to keep the chart breathing while the real explorer endpoint is
 * unavailable.
 */
export function nextSample(history: NetworkSample[], rng: () => number = Math.random): NetworkSample {
  const last = history[history.length - 1];
  const inDelta = (rng() - 0.5) * 1.6;
  const outDelta = (rng() - 0.5) * 0.8;
  const burst = rng() < 0.06 ? 4 + rng() * 4 : 0;
  return {
    ts: Date.now(),
    inKbps: clamp(last.inKbps + inDelta + burst, 0, 24),
    outKbps: clamp(last.outKbps + outDelta + burst * 0.4, 0, 12),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
