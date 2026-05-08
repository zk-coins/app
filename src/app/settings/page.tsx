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
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-[0.2em] text-ink3 uppercase">{title}</p>
      <div className="mt-3 divide-y divide-line2 rounded-md border border-line2 bg-surface px-4">
        {children}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { networkName } = useNetworkStore();
  const { account, deleteWallet } = useWalletStore();
  const { authMethod, reset: resetAuth } = useAuthStore();

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
          <h1 className="text-[28px] font-bold tracking-tight text-ink">Settings</h1>
          <p className="text-[14px] text-ink2">Wallet, network, and privacy preferences</p>
        </div>
        {networkName && (
          <span className="mt-2 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line2 bg-line/40 px-2.5 py-1 mono text-[10px] font-semibold tracking-[0.2em] text-ink2 uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-ink2" />
            {networkName}
          </span>
        )}
      </header>

      <div className="mt-8 space-y-6">
        <Section title="Security">
          <div className="flex items-start justify-between gap-6 py-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">Storage</p>
              <p className="mt-0.5 text-[12px] text-ink3">
                Keys encrypted with AES-256-GCM in IndexedDB. Never sent to any server.
              </p>
            </div>
          </div>
          <div className="flex items-start justify-between gap-6 py-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">Auth method</p>
              <p className="mt-0.5 text-[12px] text-ink3">
                {authMethod === 'passkey'
                  ? 'Passkey — wallet derived from WebAuthn PRF output'
                  : authMethod === 'seed'
                    ? 'Seed phrase — wallet encrypted with your password'
                    : 'Not configured'}
              </p>
            </div>
          </div>
          <div className="py-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">Recovery</p>
              <p className="mt-0.5 text-[12px] text-ink3">
                {authMethod === 'passkey'
                  ? 'Your wallet is derived from your passkey. As long as your passkey is synced via iCloud Keychain or Google Password Manager, you can restore it on any device.'
                  : 'Your 12-word seed phrase was shown once during wallet creation. Use it to restore your wallet on any device. If you lost it, transfer your funds to a new wallet and create a fresh backup.'}
              </p>
            </div>
          </div>
          <Toggle
            label="Auto-lock"
            description="Lock wallet after 5 minutes inactivity"
            defaultOn
            badge="Planned"
            disabled
          />
        </Section>

        <Section title="Privacy">
          <Toggle
            label="Auto-rotate receive address"
            description="Generate a fresh address after each receive"
            badge="Planned"
            disabled
          />
          <Toggle
            label="Tor routing"
            description="Connect to backend over Tor"
            badge="Planned"
            disabled
          />
        </Section>

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
          {account && (
            <div className="py-4">
              <p className="text-[13px] font-medium text-ink">Address</p>
              <p className="mt-1 mono text-[11px] break-all text-ink3">{account.address}</p>
            </div>
          )}
        </Section>

        {account && (
          <button
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
