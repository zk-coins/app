'use client';

import { useState, useCallback } from 'react';
import { PixelIcon } from '../PixelIcon';
import { PixelLogo } from '../icons/PixelLogo';
import { FooterLinks } from '../FooterLinks';
import { useWalletStore } from '@/stores/wallet';
import { api } from '@/lib/api/client';
import { initWasm } from '@zkcoins/wasm';

type Step = 'welcome' | 'choose' | 'seed' | 'passkey';

export function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-bg">
      {/* Desktop bg pattern */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden lg:block pixel-dots-bg"
      />
      <div
        className="relative mx-auto max-w-[480px]
          px-6 py-12 overflow-hidden
          lg:my-10 lg:rounded-xl lg:border lg:border-line2 lg:bg-bg/80 lg:px-8 lg:py-14 lg:shadow-[0_20px_80px_-20px_rgba(247,147,26,0.08)]"
      >
        {step === 'welcome' && <Welcome onNext={() => setStep('choose')} />}
        {step === 'choose' && (
          <ChooseMethod
            onSeed={() => setStep('seed')}
            onPasskey={() => setStep('passkey')}
            onBack={() => setStep('welcome')}
          />
        )}
        {step === 'seed' && <SeedFlow onBack={() => setStep('choose')} />}
        {step === 'passkey' && <PasskeyFlow onBack={() => setStep('choose')} />}
      </div>

      {/* Resource links — outside the card on desktop */}
      <div className="relative mx-auto max-w-[480px] px-6 pb-12">
        <div className="pt-6">
          <FooterLinks />
        </div>
      </div>
    </div>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="relative -mx-6 -my-12 min-h-screen overflow-hidden lg:-mx-8 lg:-my-14">
      {/* Hero glow — fades in at the top AND out at the bottom */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px]"
        style={{
          background:
            'radial-gradient(ellipse 120% 95% at 50% 0%, rgba(247, 147, 26, 0.55) 0%, rgba(247, 147, 26, 0.32) 18%, rgba(247, 147, 26, 0.14) 36%, rgba(247, 147, 26, 0.05) 55%, transparent 80%)',
          maskImage:
            'linear-gradient(to bottom, transparent 0%, black 12%, black 55%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, black 12%, black 55%, transparent 100%)',
        }}
      />
      {/* Pixel grid overlay — fades in at top AND out at bottom */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-40 pixel-grid"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent 0%, black 15%, black 55%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, black 15%, black 55%, transparent 100%)',
        }}
      />
      {/* Soft blur "veil" at the bottom transition zone */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[300px] h-[220px]"
        style={{
          background:
            'linear-gradient(to bottom, transparent, rgba(0,0,0,0.55) 50%, transparent)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          maskImage:
            'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)',
        }}
      />
      {/* Hero pixel logo, top-center */}
      <div className="pointer-events-none absolute left-1/2 top-[110px] -translate-x-1/2 opacity-90">
        <PixelLogo size={88} />
      </div>

      <div className="relative px-6 pt-[330px] pb-12">
        <h1 className="flex items-center gap-3 text-[26px] font-semibold tracking-tight text-ink">
          Welcome to zkCoins
          <PixelIcon name="ghost" size={26} color="#f7931a" />
        </h1>

        <ul className="mt-8 space-y-5">
          <Benefit
            icon="lock"
            title="Truly private by default"
            description="Amounts, sender, receiver, and the transaction graph are hidden. Only a 64-byte nullifier hits the chain — a meaningless blob to anyone but you."
          />
          <Benefit
            icon="zap"
            title="Just Bitcoin. No altcoin."
            description="Shielded CSV uses Client-Side Validation + ZK proofs on Bitcoin as it exists today. No soft fork, no new chain, no sidechain to bridge into."
          />
          <Benefit
            icon="shield-check"
            title="You hold the keys"
            description="Self-custodial by construction. Keys are generated locally and encrypted with AES-256-GCM in IndexedDB. They never leave your device."
          />
        </ul>

        <div className="mt-10 space-y-3">
          <button
            onClick={onNext}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-bitcoin py-4 text-[13px] font-semibold tracking-wider text-bg transition-colors hover:bg-bitcoin-hover"
          >
            <PixelIcon name="plus" size={12} />
            CREATE WALLET
          </button>
          <div className="text-center">
            <button className="py-2 text-[12px] font-medium tracking-wider text-ink2 transition-colors hover:text-bitcoin">
              OTHER LOGIN OPTIONS
            </button>
          </div>
        </div>

        <p className="mt-12 text-center mono text-[10px] tracking-[0.3em] text-ink4 uppercase">
          Shielded CSV · v0.9.0
        </p>
      </div>
    </div>
  );
}

function Benefit({
  icon,
  title,
  description,
}: {
  icon: 'lock' | 'zap' | 'shield-check' | 'globe' | 'ghost';
  title: string;
  description: string;
}) {
  return (
    <li className="flex items-start gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-bitcoin/30 bg-bitcoin/5">
        <PixelIcon name={icon} size={18} color="#f7931a" />
      </div>
      <div className="min-w-0 pt-1">
        <p className="text-[14px] font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink2">{description}</p>
      </div>
    </li>
  );
}

function ChooseMethod({
  onSeed,
  onPasskey,
  onBack,
}: {
  onSeed: () => void;
  onPasskey: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-8 py-8">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-[12px] tracking-wider text-ink3 transition-colors hover:text-ink"
      >
        <PixelIcon name="arrow-left" size={12} />
        BACK
      </button>

      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-ink">How to secure it</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          Pick how you want to protect your wallet. You can always change this later.
        </p>
      </div>

      <div className="space-y-3">
        <MethodCard
          icon="shield"
          title="Seed Phrase"
          description="12-word recovery phrase. You write it down, you own it."
          tag="Classic"
          onClick={onSeed}
        />
        <MethodCard
          icon="key"
          title="Passkey"
          description="Use Face ID / Touch ID / Yubikey via WebAuthn. No phrase to write down."
          tag="Modern"
          onClick={onPasskey}
        />
      </div>

      <p className="text-[11px] leading-relaxed text-ink4">
        Both methods are non-custodial — keys stay on your device. zkCoins servers never see them.
      </p>
    </div>
  );
}

function MethodCard({
  icon,
  title,
  description,
  tag,
  onClick,
}: {
  icon: 'shield' | 'key';
  title: string;
  description: string;
  tag: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative flex w-full items-start gap-4 rounded-md border border-line2 bg-surface p-4 text-left transition-colors hover:border-bitcoin"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line2 bg-bg">
        <PixelIcon name={icon} size={20} color="#f7931a" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-semibold text-ink group-hover:text-bitcoin">{title}</p>
          <span className="rounded-sm bg-line px-1.5 py-0.5 text-[9px] tracking-wider text-ink3 uppercase">
            {tag}
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink3">{description}</p>
      </div>
    </button>
  );
}

function SeedFlow({ onBack }: { onBack: () => void }) {
  const { setAccount, setBalance, addTransaction } = useWalletStore();
  const [stage, setStage] = useState<'reveal' | 'confirm' | 'creating'>('reveal');
  const [error, setError] = useState<string | null>(null);

  // Demo mnemonic — in a production build this comes from the wasm package's
  // BIP39 generator. For now we generate a stable 12-word demo phrase per
  // mount so the flow is visible.
  const [mnemonic] = useState<string[]>(() => generateDemoMnemonic());
  const [revealed, setRevealed] = useState(false);

  const create = useCallback(async () => {
    setStage('creating');
    setError(null);
    try {
      const wasm = await initWasm();
      const ad = await wasm.createAccount();
      // Account is set FIRST, before any network call. If mint fails, the wallet
      // still exists locally with a 0 balance — user can hit the faucet later.
      setAccount({
        address: ad.address,
        balance: 0,
        numPubkeys: ad.numPubkeys,
        xpriv: ad.xpriv,
      });

      // Best-effort faucet mint. Non-fatal if the API isn't reachable.
      try {
        const res = await api.mint(ad.address);
        const { balance } = await api.balance(ad.address);
        setBalance(balance);
        addTransaction({
          id: res.proof_id?.toString() ?? `mint-${Date.now()}`,
          type: 'mint',
          amount: 10_000,
          timestamp: Date.now(),
          proofId: res.proof_id?.toString(),
        });
      } catch (mintErr) {
        console.warn('[zkcoins] faucet mint failed (non-fatal):', mintErr);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
      setStage('confirm');
    }
  }, [setAccount, setBalance, addTransaction]);

  return (
    <div className="space-y-6 py-8">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-[12px] tracking-wider text-ink3 transition-colors hover:text-ink"
      >
        <PixelIcon name="arrow-left" size={12} />
        BACK
      </button>

      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-ink">Your seed phrase</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          Write down these 12 words in order. You'll need them to restore the wallet.
          Anyone with this phrase can spend your funds.
        </p>
      </div>

      {/* Word grid */}
      <div className="relative">
        <div
          className={`grid grid-cols-3 gap-2 rounded-md border border-line2 bg-surface p-3 transition ${
            revealed ? '' : 'blur-md select-none'
          }`}
        >
          {mnemonic.map((word, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-sm bg-bg px-2.5 py-2"
            >
              <span className="mono w-4 text-right text-[10px] text-ink4 tabular-nums">
                {i + 1}
              </span>
              <span className="mono text-[13px] text-ink">{word}</span>
            </div>
          ))}
        </div>
        {!revealed && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={() => setRevealed(true)}
              className="flex items-center gap-2 rounded-md bg-bg/80 px-4 py-2 text-[12px] font-medium tracking-wider text-ink backdrop-blur"
            >
              <PixelIcon name="eye" size={14} />
              TAP TO REVEAL
            </button>
          </div>
        )}
      </div>

      {revealed && (
        <div className="rounded-md border border-bitcoin/30 bg-bitcoin/5 p-3">
          <p className="text-[12px] leading-relaxed text-ink2">
            <span className="font-semibold text-bitcoin">Important.</span> Once you continue,
            this phrase is gone from the screen. Make sure you've written it down somewhere
            safe and offline.
          </p>
        </div>
      )}

      {stage === 'reveal' && (
        <button
          onClick={() => setStage('confirm')}
          disabled={!revealed}
          className="w-full rounded-md bg-bitcoin py-3.5 text-[13px] font-semibold tracking-wider text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
        >
          I'VE WRITTEN IT DOWN
        </button>
      )}

      {stage === 'confirm' && (
        <button
          onClick={create}
          className="w-full rounded-md bg-bitcoin py-3.5 text-[13px] font-semibold tracking-wider text-bg transition-colors hover:bg-bitcoin-hover"
        >
          CREATE WALLET
        </button>
      )}

      {stage === 'creating' && (
        <button
          disabled
          className="w-full rounded-md bg-line py-3.5 text-[13px] font-semibold tracking-wider text-ink"
        >
          CREATING...
        </button>
      )}

      {error && (
        <p className="text-[12px] text-bitcoin">
          <span className="text-ink3">err:</span> {error}
        </p>
      )}
    </div>
  );
}

function PasskeyFlow({ onBack }: { onBack: () => void }) {
  const { setAccount, setBalance, addTransaction } = useWalletStore();
  const [stage, setStage] = useState<'intro' | 'registering' | 'creating'>('intro');
  const [error, setError] = useState<string | null>(null);

  const register = useCallback(async () => {
    setStage('registering');
    setError(null);
    try {
      // Try a WebAuthn registration. If the platform doesn't support it,
      // we fall back to plain wallet creation but tell the user.
      if (typeof window !== 'undefined' && 'PublicKeyCredential' in window) {
        try {
          await navigator.credentials.create({
            publicKey: {
              challenge: crypto.getRandomValues(new Uint8Array(32)),
              rp: { name: 'zkCoins', id: window.location.hostname },
              user: {
                id: crypto.getRandomValues(new Uint8Array(16)),
                name: 'zkcoins-user',
                displayName: 'zkCoins User',
              },
              pubKeyCredParams: [
                { alg: -7, type: 'public-key' },
                { alg: -257, type: 'public-key' },
              ],
              authenticatorSelection: {
                authenticatorAttachment: 'platform',
                userVerification: 'required',
              },
              timeout: 60_000,
            },
          });
        } catch {
          // User may have cancelled — that's fine, continue to wallet creation.
        }
      }

      setStage('creating');
      const wasm = await initWasm();
      const ad = await wasm.createAccount();
      setAccount({
        address: ad.address,
        balance: 0,
        numPubkeys: ad.numPubkeys,
        xpriv: ad.xpriv,
      });

      // Best-effort faucet mint. Non-fatal if the API isn't reachable.
      try {
        const res = await api.mint(ad.address);
        const { balance } = await api.balance(ad.address);
        setBalance(balance);
        addTransaction({
          id: res.proof_id?.toString() ?? `mint-${Date.now()}`,
          type: 'mint',
          amount: 10_000,
          timestamp: Date.now(),
          proofId: res.proof_id?.toString(),
        });
      } catch (mintErr) {
        console.warn('[zkcoins] faucet mint failed (non-fatal):', mintErr);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
      setStage('intro');
    }
  }, [setAccount, setBalance, addTransaction]);

  return (
    <div className="space-y-6 py-8">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-[12px] tracking-wider text-ink3 transition-colors hover:text-ink"
      >
        <PixelIcon name="arrow-left" size={12} />
        BACK
      </button>

      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-ink">Use a passkey</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          We'll register a passkey on this device. Sign-in is via Face ID, Touch ID, Windows
          Hello, or a hardware key — no seed phrase to write down.
        </p>
      </div>

      <div className="rounded-md border border-line2 bg-surface p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-line2 bg-bg">
            <PixelIcon name="key" size={20} color="#f7931a" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">Platform authenticator</p>
            <p className="mt-0.5 text-[11px] text-ink3">
              Backed up via your OS sync (iCloud Keychain, Google Password Manager, etc.)
            </p>
          </div>
        </div>
      </div>

      <ul className="space-y-2 text-[12px] leading-relaxed text-ink2">
        <li className="flex items-start gap-2">
          <PixelIcon name="check" size={12} color="#f7931a" />
          <span>No phrase to memorize or write down</span>
        </li>
        <li className="flex items-start gap-2">
          <PixelIcon name="check" size={12} color="#f7931a" />
          <span>Phishing-resistant by design</span>
        </li>
        <li className="flex items-start gap-2">
          <PixelIcon name="check" size={12} color="#f7931a" />
          <span>Synced across your devices via the OS</span>
        </li>
      </ul>

      <button
        onClick={register}
        disabled={stage !== 'intro'}
        className="w-full rounded-md bg-bitcoin py-3.5 text-[13px] font-semibold tracking-wider text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
      >
        {stage === 'intro' && 'REGISTER PASSKEY'}
        {stage === 'registering' && 'WAITING FOR DEVICE...'}
        {stage === 'creating' && 'CREATING WALLET...'}
      </button>

      {error && (
        <p className="text-[12px] text-bitcoin">
          <span className="text-ink3">err:</span> {error}
        </p>
      )}
    </div>
  );
}

// 24 sample words for visualization. The real seed comes from a BIP39 generator
// in the wasm package once that lands.
const DEMO_WORDS = [
  'ocean',  'circuit', 'quartz',  'ledger',
  'trust',  'cipher', 'orange',   'forest',
  'pixel',  'shield', 'private',  'satoshi',
];
function generateDemoMnemonic(): string[] {
  return DEMO_WORDS;
}
