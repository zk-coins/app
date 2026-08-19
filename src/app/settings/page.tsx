'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { useNetworkStore } from '@/stores/network';
import { APP_VERSION } from '@/lib/format';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { deleteCredential } from '@/lib/crypto/storage';
import { FEATURES } from '@/lib/features';

function Toggle({
  label,
  description,
  badge,
}: {
  label: string;
  description?: string;
  badge?: string;
}) {
  // Planned-only: every call site ships a disabled toggle with badge + description.
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-medium text-ink2">{label}</p>
          {badge && (
            <span className="rounded-sm bg-line2 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-ink3 uppercase">
              {badge}
            </span>
          )}
        </div>
        {description && <p className="mt-0.5 text-[12px] text-ink3">{description}</p>}
      </div>
      <button
        disabled
        className="relative h-5 w-9 shrink-0 cursor-not-allowed rounded-full bg-line opacity-50 transition-colors"
        aria-pressed={false}
      >
        <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-ink transition-all" />
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
  const { network, apiUrl } = useNetworkStore();
  const { account, deleteWallet } = useWalletStore();
  const { reset: resetAuth } = useAuthStore();
  const nodeHost = apiUrl.replace(/^https?:\/\//, '');

  useEffect(() => {
    if (account) return;
    /* v8 ignore next -- This useEffect runs only after this client component mounts in a browser realm. */
    if (typeof window === 'undefined') return;
    useWalletStore.getState().restoreUnlockedSession();
    if (useWalletStore.getState().account) return;
    const t = setTimeout(() => {
      if (!useWalletStore.getState().account) router.replace('/');
    }, 100);
    return () => clearTimeout(t);
  }, [account, router]);

  const onDisconnect = async () => {
    if (
      /* v8 ignore next -- onDisconnect is reachable only from a browser-rendered button in this client component. */
      typeof window !== 'undefined' &&
      window.confirm('Disconnect this wallet? Make sure you have your seed phrase saved.')
    ) {
      await deleteCredential();
      resetAuth();
      await deleteWallet();
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
              />
            )}
            {FEATURES.TOR_ROUTING && (
              <Toggle
                label="Tor routing"
                description="Connect to backend over Tor"
                badge="Planned"
              />
            )}
          </Section>
        )}

        <Section title="About">
          <div className="flex items-start justify-between gap-6 py-4">
            <p className="text-[13px] font-medium text-ink">Version</p>
            <p className="mono text-[12px] text-ink2">v{APP_VERSION}</p>
          </div>
          {network && (
            <div className="flex items-start justify-between gap-6 py-4">
              <p className="text-[13px] font-medium text-ink">Network</p>
              <p className="mono text-[12px] text-ink2 lowercase">{network}</p>
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
