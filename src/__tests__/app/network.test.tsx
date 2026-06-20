/**
 * NetworkPage (`src/app/network/page.tsx`).
 *
 * The `/network` route fetches a 6-hour activity window once, then keeps
 * the chart "breathing": on simulated data it ticks locally every 8 s, on
 * real explorer data it re-fetches the tail. `e2e/14-network-activity.spec.ts`
 * freezes the clock and pins one simulated frame; these unit tests drive the
 * polling state machine the frozen baseline can't — both live branches, the
 * failed initial fetch, and the loaded/placeholder swap.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import NetworkPage from '@/app/network/page';
import { getNetworkActivity, type NetworkActivity } from '@/lib/api/explorer';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/network',
}));
vi.mock('@/lib/api/explorer', () => ({ getNetworkActivity: vi.fn() }));

const mockGet = vi.mocked(getNetworkActivity);

function makeSamples(n: number, offset = 0): NetworkActivity['samples'] {
  return Array.from({ length: n }, (_, i) => ({
    ts: 1_000_000 + (offset + i) * 1000,
    inKbps: 5,
    outKbps: 2,
  }));
}

const chart = () => screen.queryByRole('img', { name: 'Network activity chart' });

beforeEach(() => {
  mockGet.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('NetworkPage', () => {
  it('shows a placeholder until loaded, then the simulated chart, and ticks locally without re-fetching', async () => {
    let resolveInitial!: (v: NetworkActivity) => void;
    mockGet.mockReturnValueOnce(new Promise<NetworkActivity>((r) => (resolveInitial = r)));

    render(<NetworkPage />);
    // loaded === false → placeholder shown, chart absent.
    expect(chart()).toBeNull();

    await act(async () => resolveInitial({ samples: makeSamples(3), source: 'simulated' }));

    expect(chart()).toBeInTheDocument();
    expect(screen.getByText(/Preview · simulated/)).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(1);

    // One poll cadence → simulated branch (local tick, no re-fetch).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('renders the live explorer chart and re-fetches the tail on each tick', async () => {
    mockGet
      .mockResolvedValueOnce({ samples: makeSamples(3), source: 'explorer' })
      .mockResolvedValueOnce({ samples: makeSamples(3, 10), source: 'explorer' })
      .mockResolvedValueOnce({ samples: [], source: 'explorer' });

    render(<NetworkPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText(/Live · 6h window · 8s refresh/)).toBeInTheDocument();
    expect(screen.queryByText(/Preview · simulated/)).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(1);

    // tick → res.samples.length > 0 → setSamples
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(mockGet).toHaveBeenCalledTimes(2);

    // tick → empty array → setSamples skipped (length > 0 false branch)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(mockGet).toHaveBeenCalledTimes(3);
  });

  it('still marks loaded when the initial fetch fails and starts no interval', async () => {
    mockGet.mockRejectedValue(new Error('boom'));

    render(<NetworkPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // .catch → loaded true with empty samples; default simulated source.
    expect(chart()).toBeInTheDocument();
    expect(screen.getByText(/Preview · simulated/)).toBeInTheDocument();

    // samples.length === 0 → second effect returns early, no interval runs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
