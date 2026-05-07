'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { FooterLinks } from '@/components/FooterLinks';
import { useNetworkStore, type NetworkId } from '@/stores/network';
import { useWalletStore } from '@/stores/wallet';

// Same demo BIP-39 phrase the onboarding flow uses — until the wasm package
// exposes a real mnemonic generator and we wire encrypted-storage retrieval.
const DEMO_SEED = [
  'ocean', 'circuit', 'quartz', 'ledger',
  'trust', 'cipher', 'orange', 'forest',
  'pixel', 'shield', 'private', 'satoshi',
];

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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
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
  const { activeNetwork, setActiveNetwork } = useNetworkStore();
  const { account, setAccount } = useWalletStore();
  const [seedRevealed, setSeedRevealed] = useState(false);

  const onDisconnect = () => {
    if (
      typeof window !== 'undefined' &&
      window.confirm('Disconnect this wallet? Make sure you have your seed phrase saved.')
    ) {
      setAccount(null);
    }
  };

  return (
    <AppShell>
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-[28px] font-bold tracking-tight text-ink">Settings</h1>
          <p className="text-[14px] text-ink2">Wallet, network, and privacy preferences</p>
        </div>
        <span
          className={`mt-2 inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 mono text-[10px] font-semibold tracking-[0.2em] uppercase ${
            activeNetwork === 'mainnet'
              ? 'border-bitcoin/40 bg-bitcoin/10 text-bitcoin'
              : 'border-line2 bg-line/40 text-ink2'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              activeNetwork === 'mainnet' ? 'bg-bitcoin' : 'bg-ink2'
            }`}
          />
          {activeNetwork}
        </span>
      </header>

      <div className="mt-8 space-y-6">
        <Section title="Network">
          <div className="flex items-start justify-between gap-6 py-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">Network</p>
              <p className="mt-0.5 text-[12px] text-ink3">
                Switch between Bitcoin mainnet and testnet
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-line2 bg-bg p-0.5 text-[11px]">
              {(['mainnet', 'testnet'] as NetworkId[]).map((n) => (
                <button
                  key={n}
                  onClick={() => setActiveNetwork(n)}
                  className={`rounded-sm px-3 py-1 tracking-wide transition-colors ${
                    activeNetwork === n ? 'bg-line2 text-ink' : 'text-ink3 hover:text-ink'
                  }`}
                >
                  {n === 'mainnet' ? 'Mainnet' : 'Testnet'}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Display">
          <div className="flex items-start justify-between gap-6 py-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">Display Currency</p>
              <p className="mt-0.5 text-[12px] text-ink3">Fiat reference shown next to BTC</p>
            </div>
            <select className="rounded-md border border-line2 bg-bg px-3 py-1.5 text-[12px] text-ink outline-none focus:border-bitcoin">
              <option>USD</option>
              <option>EUR</option>
              <option>CHF</option>
              <option>None</option>
            </select>
          </div>
          <div className="flex items-start justify-between gap-6 py-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">Units</p>
              <p className="mt-0.5 text-[12px] text-ink3">BTC or sats for amounts</p>
            </div>
            <select className="rounded-md border border-line2 bg-bg px-3 py-1.5 text-[12px] text-ink outline-none focus:border-bitcoin">
              <option>BTC</option>
              <option>sats</option>
            </select>
          </div>
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

        <Section title="Security">
          <div className="flex items-start justify-between gap-6 py-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">Storage</p>
              <p className="mt-0.5 text-[12px] text-ink3">
                Keys encrypted with AES-256-GCM in IndexedDB. Never sent to any server.
              </p>
            </div>
          </div>
          <Toggle
            label="Auto-lock"
            description="Lock wallet after 5 minutes inactivity"
            defaultOn
          />
          <div className="py-4">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">Reveal seed phrase</p>
                <p className="mt-0.5 text-[12px] text-ink3">
                  {seedRevealed
                    ? 'Write these 12 words down somewhere safe and offline'
                    : 'Show your 12 BIP-39 words again'}
                </p>
              </div>
              <button
                onClick={() => setSeedRevealed((v) => !v)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line2 px-3 py-1.5 text-[12px] tracking-wide text-ink transition-colors hover:border-bitcoin hover:text-bitcoin"
              >
                {seedRevealed ? <EyeOff size={12} strokeWidth={2} /> : <Eye size={12} strokeWidth={2} />}
                {seedRevealed ? 'Hide' : 'Reveal'}
              </button>
            </div>
            {seedRevealed && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {DEMO_SEED.map((word, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md border border-line2 bg-bg px-2.5 py-2"
                  >
                    <span className="mono text-[10px] tabular-nums text-ink4">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="mono text-[12px] text-ink">{word}</span>
                  </div>
                ))}
              </div>
            )}
            {seedRevealed && (
              <p className="mt-3 text-[11px] leading-relaxed text-ink3">
                Anyone with these words can spend your coins. Never share them, never type them
                into a website, and prefer paper or steel storage over screenshots.
              </p>
            )}
          </div>
        </Section>

        <Section title="Resources">
          <div className="py-4">
            <FooterLinks variant="grid" />
          </div>
        </Section>

        <Section title="About">
          <div className="flex items-start justify-between gap-6 py-4">
            <p className="text-[13px] font-medium text-ink">Version</p>
            <p className="mono text-[12px] text-ink2">v0.9.0</p>
          </div>
          <div className="flex items-start justify-between gap-6 py-4">
            <p className="text-[13px] font-medium text-ink">Network</p>
            <p className="mono text-[12px] text-ink2 lowercase">{activeNetwork}</p>
          </div>
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
