/**
 * Tests for the AppShell + BottomNav navigation chrome.
 *
 * AppShell wraps every wallet route. Its props control whether the
 * bottom-nav and footer-links render; getting either wrong leaves
 * either the user stranded (no way back to /) or a non-MVP route
 * exposed inside a `showNav={false}` flow. BottomNav additionally
 * dead-strips the `Apps` tab via `FEATURES.APPS_DIRECTORY` — a
 * regression that flipped that gate would leak DEV-only chrome into
 * the PRD bundle.
 *
 * Neither component had a unit test before; e2e covered the styled
 * default, not the prop matrix or the active-tab logic across paths
 * with sub-routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from '@/components/AppShell';

const FEATURES_STATE = vi.hoisted(() => ({
  USERNAMES: false,
  APPS_DIRECTORY: false,
  PASSKEY: false,
  FAUCET: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
}));
vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

let mockPathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

beforeEach(() => {
  Object.assign(FEATURES_STATE, {
    USERNAMES: false,
    APPS_DIRECTORY: false,
    PASSKEY: false,
    FAUCET: false,
    DEV_ROUTES: false,
    AUTO_LOCK: false,
    ADDRESS_ROTATION: false,
    TOR_ROUTING: false,
  });
  mockPathname = '/';
});

describe('AppShell — prop matrix', () => {
  it('renders children inside the column', () => {
    // Use a text marker rather than a `data-testid` for the fixture —
    // `e2e/_audit/coverage.mjs` walks the entire `src/` tree (including
    // `src/__tests__/`) and would flag a test-only testid as an
    // uncovered MVP id.
    render(
      <AppShell>
        <p>shell-payload-marker</p>
      </AppShell>,
    );
    expect(screen.getByText('shell-payload-marker')).toBeInTheDocument();
  });

  it('renders BottomNav and FooterLinks by default', () => {
    render(
      <AppShell>
        <span />
      </AppShell>,
    );
    expect(screen.getByTestId('nav-wallet')).toBeInTheDocument();
    expect(screen.getByTestId('nav-settings')).toBeInTheDocument();
    // FooterLinks render at least one link.
    expect(document.querySelectorAll('[data-testid^="footer-link-"]').length).toBeGreaterThan(0);
  });

  it('omits BottomNav when showNav={false}', () => {
    render(
      <AppShell showNav={false}>
        <span />
      </AppShell>,
    );
    expect(screen.queryByTestId('nav-wallet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-settings')).not.toBeInTheDocument();
  });

  it('omits FooterLinks when showFooterLinks={false}', () => {
    render(
      <AppShell showFooterLinks={false}>
        <span />
      </AppShell>,
    );
    expect(document.querySelectorAll('[data-testid^="footer-link-"]')).toHaveLength(0);
  });
});

describe('BottomNav (PRD bundle: FEATURES.APPS_DIRECTORY off) — active-tab logic', () => {
  it('highlights Wallet when pathname is exactly "/"', () => {
    mockPathname = '/';
    render(
      <AppShell>
        <span />
      </AppShell>,
    );
    const wallet = screen.getByTestId('nav-wallet');
    expect(wallet.className).toContain('bg-bitcoin');
    expect(wallet.className).toContain('text-bg');
    const settings = screen.getByTestId('nav-settings');
    expect(settings.className).not.toContain('bg-bitcoin');
  });

  it('does NOT highlight Wallet for non-root paths (no startsWith trap on "/")', () => {
    // The home tab is special-cased: "/" must be an exact match, not a
    // startsWith — otherwise every route (/send, /receive, /settings)
    // would highlight the Wallet tab.
    mockPathname = '/send';
    render(
      <AppShell>
        <span />
      </AppShell>,
    );
    const wallet = screen.getByTestId('nav-wallet');
    expect(wallet.className).not.toContain('bg-bitcoin');
  });

  it('highlights Settings on /settings (exact)', () => {
    mockPathname = '/settings';
    render(
      <AppShell>
        <span />
      </AppShell>,
    );
    expect(screen.getByTestId('nav-settings').className).toContain('bg-bitcoin');
  });

  it('highlights Settings on a /settings/* sub-route (startsWith)', () => {
    mockPathname = '/settings/security';
    render(
      <AppShell>
        <span />
      </AppShell>,
    );
    expect(screen.getByTestId('nav-settings').className).toContain('bg-bitcoin');
  });

  it('does NOT render the Apps tab when FEATURES.APPS_DIRECTORY is off', () => {
    render(
      <AppShell>
        <span />
      </AppShell>,
    );
    expect(screen.queryByTestId('nav-apps')).not.toBeInTheDocument();
  });
});

describe('BottomNav (DEV bundle: FEATURES.APPS_DIRECTORY on)', () => {
  // `TABS` in BottomNav.tsx is computed at module evaluation time using the
  // current value of `FEATURES.APPS_DIRECTORY`. Toggling the holder at
  // runtime after the module is cached has no effect, so the gate is
  // re-asserted here by flipping the flag and re-importing through a
  // fresh module graph.
  it('renders the Apps tab when the flag is enabled', async () => {
    FEATURES_STATE.APPS_DIRECTORY = true;
    vi.resetModules();
    const { AppShell: AppShellWithApps } = await import('@/components/AppShell');
    render(
      <AppShellWithApps>
        <span />
      </AppShellWithApps>,
    );
    expect(screen.getByTestId('nav-apps')).toBeInTheDocument();
    expect(screen.getByTestId('nav-apps')).toHaveAttribute('href', '/apps');
  });

  it('highlights Apps on /apps and a sub-route', async () => {
    FEATURES_STATE.APPS_DIRECTORY = true;
    vi.resetModules();
    const { AppShell: AppShellWithApps } = await import('@/components/AppShell');

    mockPathname = '/apps/dfx';
    render(
      <AppShellWithApps>
        <span />
      </AppShellWithApps>,
    );
    expect(screen.getByTestId('nav-apps').className).toContain('bg-bitcoin');
  });
});
