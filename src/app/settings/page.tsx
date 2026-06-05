'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { FooterLinks } from '@/components/FooterLinks';
import { useNetworkStore } from '@/stores/network';
import { APP_VERSION } from '@/lib/format';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { deleteCredential } from '@/lib/crypto/storage';
import { FEATURES } from '@/lib/features';

function Toggle({
  label,
  description,
  defaultOn = false,
  disabled = false,
  badge,
}: {
  label: string;
  description?: string;
  defaultOn?: boolean;
  disabled?: boolean;
  badge?: string;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-[13px] font-medium ${disabled ? 'text-ink2' : 'text-ink'}`}>
            {label}
          </p>
          {badge && (
            <span className="rounded-sm bg-line2 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-ink3 uppercase">
              {badge}
            </span>
          )}
        </div>
        {description && <p className="mt-0.5 text-[12px] text-ink3">{description}</p>}
      </div>
      <button
        onClick={() => !disabled && setOn((v) => !v)}
        disabled={disabled}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          disabled ? 'cursor-not-allowed bg-line opacity-50' : on ? 'bg-bitcoin' : 'bg-line2'
        }`}
        aria-pressed={on}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink transition-all ${
            on ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const testid = `settings-section-${title.toLowerCase()}`;
  return (
    <div data-testid={testid}>
      <p
        data-testid={`${testid}-title`}
        className="text-[10px] font-semibold tracking-[0.2em] text-ink3 uppercase"
      >
        {title}
      </p>
      <div className="mt-3 divide-y divide-line2 rounded-md border border-line2 bg-surface px-4">
        {children}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { networkName, apiUrl } = useNetworkStore();
  const { account, deleteWallet } = useWalletStore();
  const { reset: resetAuth } = useAuthStore();
  const nodeHost = apiUrl.replace(/^https?:\/\//, '');

  useEffect(() => {
    if (!account && typeof window !== 'undefined') {
      const t = setTimeout(() => {
        if (!useWalletStore.getState().account) router.replace('/');
      }, 100);
      return () => clearTimeout(t);
    }
  }, [account, router]);

  const onDisconnect = async () => {
    if (
      typeof window !== 'undefined' &&
      window.confirm('Disconnect this wallet? Make sure you have your seed phrase saved.')
    ) {
      await deleteWallet();
      await deleteCredential();
      resetAuth();
    }
  };

  return (
    <AppShell>
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1
            data-testid="settings-heading"
            className="text-[28px] font-bold tracking-tight text-ink"
          >
            Settings
          </h1>
        </div>
      </header>

      <div className="mt-8 space-y-6">
        {(FEATURES.ADDRESS_ROTATION || FEATURES.TOR_ROUTING) && (
          <Section title="Privacy">
            {FEATURES.ADDRESS_ROTATION && (
              <Toggle
                label="Auto-rotate receive address"
                description="Generate a fresh address after each receive"
                badge="Planned"
                disabled
              />
            )}
            {FEATURES.TOR_ROUTING && (
              <Toggle
                label="Tor routing"
                description="Connect to backend over Tor"
                badge="Planned"
                disabled
              />
            )}
          </Section>
        )}

        <Section title="Resources">
          <div className="py-4">
            <FooterLinks variant="grid" />
          </div>
        </Section>

        <Section title="About">
          <div className="flex items-start justify-between gap-6 py-4">
            <p className="text-[13px] font-medium text-ink">Version</p>
            <p className="mono text-[12px] text-ink2">v{APP_VERSION}</p>
          </div>
          {networkName && (
            <div className="flex items-start justify-between gap-6 py-4">
              <p className="text-[13px] font-medium text-ink">Network</p>
              <p className="mono text-[12px] text-ink2 lowercase">{networkName}</p>
            </div>
          )}
          <div className="flex items-start justify-between gap-6 py-4">
            <p className="shrink-0 text-[13px] font-medium text-ink">Node</p>
            <p
              data-testid="settings-node-host"
              className="mono text-[12px] break-all text-right text-ink2"
            >
              {nodeHost}
            </p>
          </div>
        </Section>

        {account && (
          <button
            data-testid="settings-disconnect-btn"
            onClick={onDisconnect}
            className="w-full rounded-md border border-line2 py-3 text-[13px] font-semibold tracking-wide text-ink2 transition-colors hover:border-bitcoin/40 hover:text-bitcoin"
          >
            Disconnect Wallet
          </button>
        )}
      </div>
    </AppShell>
  );
}
