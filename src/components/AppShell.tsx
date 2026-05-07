'use client';

import { ReactNode } from 'react';
import { BottomNav } from './BottomNav';
import { FooterLinks } from './FooterLinks';

/**
 * Mobile-first shell with a centered column. On large viewports, the column
 * is rendered as a bordered "card" frame; resource links sit outside the
 * frame so they read as ambient app chrome rather than wallet content.
 */
export function AppShell({
  children,
  showNav = true,
  showFooterLinks = true,
  maxWidth = 'max-w-[480px]',
}: {
  children: ReactNode;
  showNav?: boolean;
  showFooterLinks?: boolean;
  maxWidth?: string;
}) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-bg">
      {/* Decorative bg — visible only on tall+wide viewports */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden lg:block pixel-dots-bg"
      />
      {/* Subtle radial orange glow behind the column on desktop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden lg:block"
        style={{
          background:
            'radial-gradient(ellipse 600px 800px at 50% 30%, rgba(247, 147, 26, 0.04) 0%, transparent 70%)',
        }}
      />

      {/* Card column — full bleed on mobile, framed on desktop */}
      <div
        className={`relative mx-auto ${maxWidth}
          px-6 pt-12 pb-8
          lg:my-10 lg:rounded-xl lg:border lg:border-line2 lg:bg-bg/80 lg:px-10 lg:pt-14 lg:pb-10 lg:shadow-[0_20px_80px_-20px_rgba(247,147,26,0.08)] lg:backdrop-blur-sm`}
      >
        {children}
      </div>

      {/* Resource links — sit OUTSIDE the card frame, above the floating nav */}
      {showFooterLinks && (
        <div className={`relative mx-auto ${maxWidth} px-6 ${showNav ? 'pb-32' : 'pb-12'}`}>
          <div className="pt-6">
            <FooterLinks />
          </div>
        </div>
      )}

      {showNav && <BottomNav />}
    </div>
  );
}
