/**
 * RootLayout (`src/app/layout.tsx`) — the Next.js root layout. No branching
 * logic; it wraps children in the html/body shell + intl provider and exports
 * the app `metadata` / `viewport`. `next/font/google` is mocked because the
 * Next SWC font transform is not available under vitest.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';

vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--font-sans' }),
  JetBrains_Mono: () => ({ variable: '--font-mono' }),
  VT323: () => ({ variable: '--font-pixel' }),
}));

import RootLayout, { metadata, viewport } from '@/app/layout';

describe('RootLayout', () => {
  it('exposes the app metadata and viewport', () => {
    expect(String(metadata.title)).toContain('zkCoins');
    expect(metadata.manifest).toBe('/manifest.json');
    expect(viewport.themeColor).toBe('#000000');
  });

  it('wraps children in the html → body shell', () => {
    const tree = RootLayout({ children: 'hello' }) as ReactElement<{ children: ReactElement }>;
    expect(tree.type).toBe('html');
    expect(tree.props.children.type).toBe('body');
  });
});
