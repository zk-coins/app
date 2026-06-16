import { describe, it, expect } from 'vitest';
import { buildHistory, nextSample, type NetworkSample } from '@/lib/simulate-network';

const IN_MAX = 24;
const OUT_MAX = 12;

function assertInRange(s: NetworkSample) {
  expect(Number.isFinite(s.ts)).toBe(true);
  expect(s.inKbps).toBeGreaterThanOrEqual(0);
  expect(s.inKbps).toBeLessThanOrEqual(IN_MAX);
  expect(s.outKbps).toBeGreaterThanOrEqual(0);
  expect(s.outKbps).toBeLessThanOrEqual(OUT_MAX);
}

describe('buildHistory', () => {
  it('returns the default 220-sample window with both channels in range', () => {
    // No args → every destructured default is taken (incl. endTs = Date.now()).
    const samples = buildHistory();
    expect(samples).toHaveLength(220);
    samples.forEach(assertInRange);
  });

  it('is deterministic for a fixed seed + endTs', () => {
    // All options provided → no default is taken.
    const opts = { count: 16, spanMs: 1000, endTs: 5000, seed: 42 };
    expect(buildHistory(opts)).toEqual(buildHistory(opts));
  });

  it('spaces timestamps evenly across the span, ending one step before endTs', () => {
    // ts = endTs - spanMs + i*dt, dt = spanMs / count = 100.
    const ts = buildHistory({ count: 4, spanMs: 400, endTs: 1000, seed: 1 }).map((s) => s.ts);
    expect(ts).toEqual([600, 700, 800, 900]);
  });

  it('produces different waveforms for different seeds', () => {
    const a = buildHistory({ seed: 1, endTs: 0 });
    const b = buildHistory({ seed: 2, endTs: 0 });
    expect(a).not.toEqual(b);
  });
});

describe('nextSample', () => {
  it('builds a live sample from an injected deterministic rng', () => {
    let n = 0;
    const rng = () => {
      n = (n + 0.37) % 1;
      return n;
    };
    assertInRange(nextSample([], rng));
  });

  it('defaults to Math.random when no rng is passed', () => {
    // Exercises the `rng = Math.random` default-parameter branch.
    assertInRange(nextSample([]));
  });
});
