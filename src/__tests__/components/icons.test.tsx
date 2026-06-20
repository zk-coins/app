/**
 * Brand logo icons (`src/components/icons/Logo.tsx`, `PixelLogo.tsx`) — small
 * pixel-art SVGs. Decorative but default-active, so the sprite→rect render and
 * the size/prop surface are unit-pinned.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Logo } from '@/components/icons/Logo';
import { PixelLogo } from '@/components/icons/PixelLogo';

afterEach(cleanup);

describe('Logo', () => {
  it('renders the labelled logo svg at the default size', () => {
    render(<Logo />);
    const svg = screen.getByRole('img', { name: 'zkCoins' });
    expect(svg).toHaveAttribute('width', '28');
    expect(svg.querySelectorAll('rect').length).toBeGreaterThan(0);
  });

  it('accepts an explicit size and forwards extra svg props', () => {
    const { container } = render(<Logo size={48} aria-hidden />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '48');
  });
});

describe('PixelLogo', () => {
  it('renders the logo svg at the default size', () => {
    const { container } = render(<PixelLogo />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '32');
    expect(svg.querySelectorAll('rect').length).toBeGreaterThan(0);
  });

  it('accepts an explicit size and forwards extra svg props', () => {
    const { container } = render(<PixelLogo size={64} aria-hidden />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '64');
  });
});
