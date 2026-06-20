/**
 * NetworkActivity chart (`src/components/NetworkActivity.tsx`).
 *
 * A pure presentational SVG chart over a sample window — no state, no
 * timers. `e2e/14-network-activity.spec.ts` pins its pixels against a
 * frozen waveform; these unit tests lock in the data→geometry branches
 * (empty vs populated window, the live readouts, the curve builder's
 * endpoint handling) that the visual baseline can't distinguish.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NetworkActivity } from '@/components/NetworkActivity';
import type { NetworkSample } from '@/lib/simulate-network';

afterEach(cleanup);

function makeSamples(n: number): NetworkSample[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: 1_000_000 + i * 60_000,
    inKbps: 5 + (i % 5),
    outKbps: 2 + (i % 3),
  }));
}

describe('NetworkActivity', () => {
  it('renders the chart, axis labels, and live readouts for a populated window', () => {
    const samples = makeSamples(7);
    const { container } = render(<NetworkActivity samples={samples} className="my-extra" />);

    // className passthrough (the `className ?? ''` truthy branch).
    expect(container.firstChild).toHaveClass('my-extra');
    expect(screen.getByRole('img', { name: 'Network activity chart' })).toBeInTheDocument();

    // Live readouts reflect the last sample, formatted to 1 decimal.
    const last = samples[samples.length - 1];
    expect(screen.getByText(`${last.inKbps.toFixed(1)} KB/s`)).toBeInTheDocument();
    expect(screen.getByText(`${last.outKbps.toFixed(1)} KB/s`)).toBeInTheDocument();

    // Curve + area paths were built (buildPaths + catmullRomToBezier ran).
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(4); // inArea, outArea, inPath, outPath
    paths.forEach((p) => expect(p.getAttribute('d')).not.toBe(''));

    // 7 x-axis time labels (buildXLabels populated branch + formatLocalTime).
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts.filter((t) => /^\d{1,2}:\d{2}/.test(t ?? '')).length).toBe(7);
  });

  it('renders zeroed readouts and no curve for an empty window, without a className', () => {
    const { container } = render(<NetworkActivity samples={[]} />);

    // `className ?? ''` falsy branch — no extra class, base classes intact.
    expect(container.firstChild).toHaveClass('rounded-xl');
    // `last?.inKbps ?? 0` / `?? 0` — both readouts fall back to 0.
    expect(screen.getAllByText('0.0 KB/s')).toHaveLength(2);

    // buildPaths + buildXLabels short-circuit (length < 2): empty path data.
    container.querySelectorAll('path').forEach((p) => expect(p.getAttribute('d')).toBe(''));
    const timeLabels = Array.from(container.querySelectorAll('text'))
      .map((t) => t.textContent)
      .filter((t) => /^\d{1,2}:\d{2}/.test(t ?? ''));
    expect(timeLabels).toHaveLength(0);
  });
});
