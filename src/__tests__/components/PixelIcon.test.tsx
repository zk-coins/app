/**
 * PixelIcon (`src/components/PixelIcon.tsx`) — pixel-art SVG icons rendered
 * from a 12×12 '#'/' ' sprite map. Decorative, but default-active, so the
 * render path (sprite → 1×1 rects) and the prop surface are unit-pinned.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PixelIcon, type PixelName } from '@/components/PixelIcon';

afterEach(cleanup);

const NAMES: PixelName[] = [
  'logo',
  'send',
  'receive',
  'wallet',
  'apps',
  'settings',
  'eye',
  'eye-off',
  'copy',
  'check',
  'list',
  'arrow-left',
  'key',
  'shield',
  'plus',
  'zap',
  'globe',
  'shield-check',
  'ghost',
  'lock',
  'home',
  'x',
];

describe('PixelIcon', () => {
  it('renders every icon in the map as a 12×12 svg of 1×1 rects', () => {
    for (const name of NAMES) {
      const { container, unmount } = render(<PixelIcon name={name} />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('viewBox')).toBe('0 0 12 12');
      // Filled cells → the `=== '#'` true branch; blank cells → the false branch.
      expect(container.querySelectorAll('rect').length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('honours explicit size, color and className and forwards extra svg props', () => {
    const { container } = render(
      <PixelIcon name="check" size={32} color="#f7931a" className="my-icon" aria-label="ok" />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
    expect(svg).toHaveClass('pixel-edges', 'my-icon'); // `className ?? ''` truthy
    expect(svg).toHaveAttribute('aria-label', 'ok'); // `...rest` spread
    expect(svg.querySelector('rect')).toHaveAttribute('fill', '#f7931a');
  });

  it('defaults size to 16 and colour to currentColor with no className', () => {
    const { container } = render(<PixelIcon name="logo" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveClass('pixel-edges'); // `className ?? ''` falsy
    expect(svg.querySelector('rect')).toHaveAttribute('fill', 'currentColor');
  });
});
