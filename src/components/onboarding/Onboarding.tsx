'use client';

import { useState, useCallback, useEffect } from 'react';
import { Lock, Zap, Key, type LucideIcon } from 'lucide-react';
import { PixelIcon } from '../PixelIcon';
import { PixelLogo } from '../icons/PixelLogo';
import { Logo } from '../icons/Logo';
import { FooterLinks } from '../FooterLinks';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api/client';
import { initWasm } from '@zkcoins/wasm';
import { APP_VERSION } from '@/lib/format';
import {
  createPasskey,
  authenticatePasskey,
  isPasskeySupported,
  PasskeyPrfUnsupportedError,
} from '@/lib/crypto/passkey';
import { deriveMnemonicFromPrf, DERIVATION_VERSION } from '@/lib/crypto/key-derivation';
import { saveCredential } from '@/lib/crypto/storage';
import { FEATURES } from '@/lib/features';

/** Small consistent header for onboarding sub-steps. */
function StepHeader({ onBack }: { onBack?: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <Logo size={26} />
        <span className="text-[15px] font-semibold tracking-tight text-ink">zkCoins</span>
      </div>
      {onBack && (
        <button
          data-testid="onboarding-step-back-btn"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] text-ink3 transition-colors hover:text-ink"
        >
          <PixelIcon name="arrow-left" size={12} />
          Back
        </button>
      )}
    </div>
  );
}

type Step = 'welcome' | 'seed' | 'passkey' | 'seed-import' | 'passkey-restore';

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
          md:my-10 md:rounded-2xl md:border md:border-ink md:bg-surface md:px-8 md:py-14 md:shadow-[0_20px_80px_-20px_rgba(247,147,26,0.12)]"
      >
        {step === 'welcome' && (
          <Welcome
            onNext={() => setStep(FEATURES.PASSKEY ? 'passkey' : 'seed')}
            onRestore={() => setStep('seed-import')}
          />
        )}
        {FEATURES.PASSKEY && step === 'passkey' && (
          <PasskeyFlow onBack={() => setStep('welcome')} onUseSeed={() => setStep('seed')} />
        )}
        {step === 'seed' && (
          <SeedFlow onBack={() => setStep(FEATURES.PASSKEY ? 'passkey' : 'welcome')} />
        )}
        {step === 'seed-import' && (
          <SeedImportFlow
            onBack={() => setStep('welcome')}
            onPasskeyRestore={FEATURES.PASSKEY ? () => setStep('passkey-restore') : undefined}
          />
        )}
        {FEATURES.PASSKEY && step === 'passkey-restore' && (
          <PasskeyRestoreFlow onBack={() => setStep('seed-import')} />
        )}
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

function Welcome({ onNext, onRestore }: { onNext: () => void; onRestore: () => void }) {
  return (
    <div className="relative -mx-6 -my-12 min-h-screen overflow-hidden lg:-mx-8 lg:-my-14">
      {/* Hero glow */}
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
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[300px] h-[220px]"
        style={{
          background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.55) 50%, transparent)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          maskImage: 'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)',
        }}
      />
      <div className="pointer-events-none absolute left-1/2 top-[110px] -translate-x-1/2 opacity-90">
        <PixelLogo size={88} />
      </div>

      <div className="relative px-6 pt-[330px] pb-12">
        <h1
          data-testid="welcome-heading"
          className="flex items-center gap-3 text-[26px] font-semibold tracking-tight text-ink"
        >
          Welcome to zkCoins
          <PixelIcon name="ghost" size={26} color="#f7931a" />
        </h1>

        <ul className="mt-8 space-y-5">
          <Benefit
            icon={Lock}
            title="Truly private by default"
            description="Amounts, sender, receiver, and the transaction graph are hidden. Only a 64-byte nullifier hits the chain — a meaningless blob to anyone but you."
          />
          <Benefit
            icon={Zap}
            title="Just Bitcoin. No altcoin."
            description="Shielded CSV uses Client-Side Validation + ZK proofs on Bitcoin as it exists today. No soft fork, no new chain, no sidechain to bridge into."
          />
          <Benefit
            icon={Key}
            title="You hold the keys"
            description="Self-custodial by construction. Keys are generated locally and encrypted with AES-256-GCM in IndexedDB. They never leave your device."
          />
        </ul>

        <div className="mt-10">
          <button
            data-testid="onboarding-create-btn"
            onClick={onNext}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-bitcoin py-4 text-[13px] font-semibold tracking-wider text-bg transition-colors hover:bg-bitcoin-hover"
          >
            <PixelIcon name="plus" size={12} />
            CREATE WALLET
          </button>
        </div>

        <div className="mt-6 text-center">
          <button
            data-testid="onboarding-restore-btn"
            onClick={onRestore}
            className="text-[12px] font-medium text-ink2 transition-colors hover:text-bitcoin"
          >
            Restore existing wallet
          </button>
        </div>

        <p className="mt-8 text-center mono text-[11px] tracking-[0.3em] text-ink2 uppercase">
          Shielded CSV · v{APP_VERSION}
        </p>
      </div>
    </div>
  );
}

function Benefit({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <li className="flex items-start gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-bitcoin/30 bg-bitcoin/5 text-bitcoin">
        <Icon size={18} strokeWidth={2} />
      </div>
      <div className="min-w-0 pt-1">
        <p className="text-[14px] font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink2">{description}</p>
      </div>
    </li>
  );
}

/* ---------- Seed Flow ---------- */

function SeedFlow({ onBack }: { onBack: () => void }) {
  const { setAccount, setBalance, saveWithPassword } = useWalletStore();
  const { setAuth } = useAuthStore();
  const [stage, setStage] = useState<'generating' | 'reveal' | 'confirm' | 'password' | 'creating'>(
    'generating',
  );
  const [error, setError] = useState<string | null>(null);
  const [mnemonic, setMnemonic] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  // Generate real mnemonic on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const wasm = await initWasm();
        const phrase = wasm.generateMnemonic();
        if (!cancelled) {
          setMnemonic(phrase.split(' '));
          setStage('reveal');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to generate seed phrase');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const create = useCallback(async () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== passwordConfirm) {
      setError('Passwords do not match');
      return;
    }

    setStage('creating');
    setError(null);
    try {
      const wasm = await initWasm();
      const phrase = mnemonic.join(' ');
      const ad = await wasm.createAccountFromMnemonic(phrase);
      setAccount({
        address: ad.address,
        numPubkeys: ad.numPubkeys,
        xpriv: ad.xpriv,
      });

      // Encrypt and persist to IndexedDB.
      await saveWithPassword(password);
      setAuth('seed');

      // Best-effort balance fetch.
      try {
        const { balance } = await api.balance(ad.address);
        setBalance(balance);
      } catch {
        // Non-fatal — WalletScreen will keep its loading placeholder.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create wallet');
      setStage('password');
    }
  }, [mnemonic, password, passwordConfirm, setAccount, setBalance, saveWithPassword, setAuth]);

  return (
    <div className="space-y-6 py-2">
      <StepHeader onBack={onBack} />

      <div data-testid="seed-flow">
        <h1 className="text-[24px] font-bold tracking-tight text-ink">Your seed phrase</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          Write down these 12 words in order. You&apos;ll need them to restore the wallet. Anyone
          with this phrase can spend your funds.
        </p>
      </div>

      {stage === 'generating' && (
        <p data-testid="seed-generating" className="text-[13px] text-ink2">
          Generating seed phrase…
        </p>
      )}

      {/* Word grid */}
      {mnemonic.length > 0 && stage !== 'password' && stage !== 'creating' && (
        <div className="relative">
          <div
            data-testid="seed-grid"
            className="grid grid-cols-3 gap-2 rounded-md border border-line2 bg-surface p-3"
          >
            {mnemonic.map((word, i) => (
              <div key={i} className="flex items-center gap-2 rounded-sm bg-bg px-2.5 py-2">
                <span
                  aria-hidden="true"
                  className="mono w-4 text-right text-[10px] text-ink3 tabular-nums"
                >
                  {i + 1}
                </span>
                <span
                  className={`mono text-[13px] ${revealed ? 'text-ink' : 'text-ink select-none'}`}
                  style={revealed ? undefined : { filter: 'blur(5px)' }}
                >
                  {revealed ? word : '\u2022\u2022\u2022\u2022\u2022\u2022'}
                </span>
              </div>
            ))}
          </div>
          {!revealed && (
            <button
              data-testid="seed-reveal-btn"
              onClick={() => setRevealed(true)}
              className="absolute inset-0 flex items-center justify-center rounded-md bg-bg/40 backdrop-blur-[2px] transition-colors hover:bg-bg/30"
            >
              <span className="flex items-center gap-2 rounded-md border border-line2 bg-bg px-4 py-2 text-[12px] font-semibold tracking-wide text-ink shadow-lg">
                <PixelIcon name="eye" size={14} />
                Tap to reveal
              </span>
            </button>
          )}
        </div>
      )}

      {revealed && stage === 'reveal' && (
        <>
          <div className="rounded-md border border-bitcoin/30 bg-bitcoin/5 p-3">
            <p className="text-[12px] leading-relaxed text-ink2">
              <span className="font-semibold text-bitcoin">Important.</span> Once you continue, this
              phrase is gone from the screen. Make sure you&apos;ve written it down somewhere safe
              and offline.
            </p>
          </div>
          <button
            data-testid="seed-written-btn"
            onClick={() => setStage('confirm')}
            className="w-full rounded-md bg-bitcoin py-3.5 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover"
          >
            I&apos;ve written it down
          </button>
        </>
      )}

      {stage === 'confirm' && (
        <button
          data-testid="seed-confirm-btn"
          onClick={() => setStage('password')}
          className="w-full rounded-md bg-bitcoin py-3.5 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover"
        >
          Continue
        </button>
      )}

      {stage === 'password' && (
        <form
          data-testid="seed-password-stage"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div>
            <p className="text-[13px] font-semibold text-ink">Set an encryption password</p>
            <p className="mt-1 text-[12px] text-ink2">
              Your wallet is encrypted locally with AES-256-GCM. You&apos;ll need this password to
              unlock it on this device.
            </p>
          </div>
          <input
            data-testid="seed-password-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 characters)"
            className="w-full rounded-md border border-line2 bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
          />
          <input
            data-testid="seed-password-confirm-input"
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            placeholder="Confirm password"
            className="w-full rounded-md border border-line2 bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
          />
          <button
            type="submit"
            data-testid="seed-create-btn"
            disabled={!password || !passwordConfirm}
            className="w-full rounded-md bg-bitcoin py-3.5 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
          >
            Create wallet
          </button>
        </form>
      )}

      {stage === 'creating' && (
        <button
          data-testid="seed-creating-btn"
          disabled
          className="w-full rounded-md bg-line py-3.5 text-[14px] font-semibold tracking-tight text-ink"
        >
          Creating…
        </button>
      )}

      {error && (
        <p data-testid="seed-error" className="text-[12px] text-bad">
          <span className="text-ink3">err:</span> {error}
        </p>
      )}
    </div>
  );
}

/* ---------- Passkey Flow ---------- */

function PasskeyFlow({ onBack, onUseSeed }: { onBack: () => void; onUseSeed: () => void }) {
  const { setAccount, setBalance, saveWithPrf } = useWalletStore();
  const { setAuth } = useAuthStore();
  const [stage, setStage] = useState<'intro' | 'registering' | 'creating'>('intro');
  const [error, setError] = useState<string | null>(null);

  const register = useCallback(async () => {
    setError(null);

    if (!isPasskeySupported()) {
      setError('Passkeys are not supported on this device. Use a seed phrase instead.');
      return;
    }

    setStage('registering');

    try {
      // Phase 1 — register passkey with PRF extension.
      const result = await createPasskey();

      // Phase 2 — derive mnemonic from PRF output and create wallet deterministically.
      setStage('creating');
      const mnemonic = await deriveMnemonicFromPrf(result.prfOutput);
      const wasm = await initWasm();
      const ad = await wasm.createAccountFromMnemonic(mnemonic);

      setAccount({
        address: ad.address,
        numPubkeys: ad.numPubkeys,
        xpriv: ad.xpriv,
      });

      // Persist passkey credential metadata to IndexedDB.
      await saveCredential({
        credentialId: result.credentialId,
        derivationVersion: DERIVATION_VERSION,
        createdAt: Date.now(),
      });

      // Encrypt wallet with PRF output and save to IndexedDB.
      await saveWithPrf(result.prfOutput);
      setAuth('passkey', result.credentialId);

      // Best-effort balance fetch.
      try {
        const { balance } = await api.balance(ad.address);
        setBalance(balance);
      } catch {
        // Non-fatal — WalletScreen will keep its loading placeholder.
      }
    } catch (err) {
      if (err instanceof PasskeyPrfUnsupportedError) {
        setError(
          'Your device does not support the PRF extension needed for passkey wallets. Please use a seed phrase instead.',
        );
      } else {
        const cancelled =
          err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError');
        setError(
          cancelled
            ? 'Passkey registration cancelled.'
            : err instanceof Error
              ? err.message
              : 'Passkey registration failed.',
        );
      }
      setStage('intro');
    }
  }, [setAccount, setBalance, saveWithPrf, setAuth]);

  return (
    <div className="space-y-6 py-2">
      <StepHeader onBack={onBack} />

      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-ink">Use a passkey</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          We&apos;ll register a passkey on this device. Sign-in is via Face ID, Touch ID, Windows
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
        className="w-full rounded-md bg-bitcoin py-3.5 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
      >
        {stage === 'intro' && 'Register passkey'}
        {stage === 'registering' && 'Waiting for device…'}
        {stage === 'creating' && 'Creating wallet…'}
      </button>

      <div className="text-center">
        <button
          data-testid="passkey-other-options-btn"
          onClick={onUseSeed}
          disabled={stage !== 'intro'}
          className="py-2 text-[12px] font-medium tracking-wider text-ink2 transition-colors hover:text-bitcoin disabled:opacity-50"
        >
          OTHER LOGIN OPTIONS
        </button>
      </div>

      {error && (
        <p className="text-[12px] text-bad">
          <span className="text-ink3">err:</span> {error}
        </p>
      )}
    </div>
  );
}

/* ---------- Seed Import (Restore) Flow ---------- */

function SeedImportFlow({
  onBack,
  onPasskeyRestore,
}: {
  onBack: () => void;
  onPasskeyRestore?: () => void;
}) {
  const { setAccount, setBalance, saveWithPassword } = useWalletStore();
  const { setAuth } = useAuthStore();
  const [stage, setStage] = useState<'input' | 'password' | 'restoring'>('input');
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleValidate = useCallback(async () => {
    setError(null);
    const trimmed = phrase.trim().toLowerCase();
    const words = trimmed.split(/\s+/);
    if (words.length !== 12) {
      setError('Enter exactly 12 words');
      return;
    }
    try {
      const wasm = await initWasm();
      if (!wasm.validateMnemonic(trimmed)) {
        setError('Invalid seed phrase — check your words and try again');
        return;
      }
      setStage('password');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    }
  }, [phrase]);

  const restore = useCallback(async () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== passwordConfirm) {
      setError('Passwords do not match');
      return;
    }

    setStage('restoring');
    setError(null);
    try {
      const wasm = await initWasm();
      const trimmed = phrase.trim().toLowerCase();
      const ad = await wasm.createAccountFromMnemonic(trimmed);
      setAccount({
        address: ad.address,
        numPubkeys: ad.numPubkeys,
        xpriv: ad.xpriv,
      });
      await saveWithPassword(password);
      setAuth('seed');

      try {
        const { balance } = await api.balance(ad.address);
        setBalance(balance);
      } catch {
        // Non-fatal — WalletScreen will keep its loading placeholder.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore wallet');
      setStage('password');
    }
  }, [phrase, password, passwordConfirm, setAccount, setBalance, saveWithPassword, setAuth]);

  return (
    <div className="space-y-6 py-2">
      <StepHeader onBack={onBack} />

      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-ink">Restore wallet</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          Enter your 12-word seed phrase to restore an existing wallet.
        </p>
      </div>

      {stage === 'input' && (
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            handleValidate();
          }}
        >
          <textarea
            data-testid="seed-import-textarea"
            value={phrase}
            onChange={(e) => {
              setPhrase(e.target.value);
              setError(null);
            }}
            placeholder="Enter your 12 words separated by spaces"
            rows={3}
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-md border border-line2 bg-surface px-4 py-3 mono text-[13px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
          />
          <button
            type="submit"
            data-testid="seed-import-continue-btn"
            disabled={!phrase.trim()}
            className="w-full rounded-md bg-bitcoin py-3.5 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
          >
            Continue
          </button>
        </form>
      )}

      {stage === 'password' && (
        <form
          data-testid="seed-import-password-stage"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            restore();
          }}
        >
          <div>
            <p className="text-[13px] font-semibold text-ink">Set an encryption password</p>
            <p className="mt-1 text-[12px] text-ink2">
              Your wallet is encrypted locally with AES-256-GCM. You&apos;ll need this password to
              unlock it on this device.
            </p>
          </div>
          <input
            data-testid="seed-import-password-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 characters)"
            className="w-full rounded-md border border-line2 bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
          />
          <input
            data-testid="seed-import-password-confirm-input"
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            placeholder="Confirm password"
            className="w-full rounded-md border border-line2 bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
          />
          <button
            type="submit"
            data-testid="seed-import-submit-btn"
            disabled={!password || !passwordConfirm}
            className="w-full rounded-md bg-bitcoin py-3.5 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
          >
            Restore wallet
          </button>
        </form>
      )}

      {stage === 'restoring' && (
        <button
          data-testid="seed-import-restoring-btn"
          disabled
          className="w-full rounded-md bg-line py-3.5 text-[14px] font-semibold tracking-tight text-ink"
        >
          Restoring…
        </button>
      )}

      {error && (
        <p data-testid="seed-import-error" className="text-[12px] text-bad">
          <span className="text-ink3">err:</span> {error}
        </p>
      )}

      {onPasskeyRestore && (
        <div className="text-center">
          <button
            data-testid="passkey-restore-btn"
            onClick={onPasskeyRestore}
            disabled={stage === 'restoring'}
            className="py-2 text-[12px] font-medium tracking-wider text-ink2 transition-colors hover:text-bitcoin disabled:opacity-50"
          >
            RESTORE WITH PASSKEY
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Passkey Restore Flow ---------- */

function PasskeyRestoreFlow({ onBack }: { onBack: () => void }) {
  const { setAccount, setBalance, saveWithPrf } = useWalletStore();
  const { setAuth } = useAuthStore();
  const [stage, setStage] = useState<'intro' | 'authenticating' | 'restoring'>('intro');
  const [error, setError] = useState<string | null>(null);

  const restore = useCallback(async () => {
    setError(null);

    if (!isPasskeySupported()) {
      setError('Passkeys are not supported on this device.');
      return;
    }

    setStage('authenticating');

    try {
      const result = await authenticatePasskey();

      setStage('restoring');
      const mnemonic = await deriveMnemonicFromPrf(result.prfOutput);
      const wasm = await initWasm();
      const ad = await wasm.createAccountFromMnemonic(mnemonic);

      setAccount({
        address: ad.address,
        numPubkeys: ad.numPubkeys,
        xpriv: ad.xpriv,
      });

      await saveCredential({
        credentialId: result.credentialId,
        derivationVersion: DERIVATION_VERSION,
        createdAt: Date.now(),
      });

      await saveWithPrf(result.prfOutput);
      setAuth('passkey', result.credentialId);

      try {
        const { balance } = await api.balance(ad.address);
        setBalance(balance);
      } catch {
        // Non-fatal.
      }
    } catch (err) {
      if (err instanceof PasskeyPrfUnsupportedError) {
        setError(
          'Your device does not support the PRF extension. Please restore with a seed phrase instead.',
        );
      } else {
        const cancelled =
          err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError');
        setError(
          cancelled
            ? 'Authentication cancelled.'
            : err instanceof Error
              ? err.message
              : 'Passkey authentication failed.',
        );
      }
      setStage('intro');
    }
  }, [setAccount, setBalance, saveWithPrf, setAuth]);

  return (
    <div className="space-y-6 py-2">
      <StepHeader onBack={onBack} />

      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-ink">Restore with passkey</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          Authenticate with your existing passkey to restore your wallet. Your keys are
          deterministically derived from the passkey&apos;s PRF output.
        </p>
      </div>

      <button
        onClick={restore}
        disabled={stage !== 'intro'}
        className="w-full rounded-md bg-bitcoin py-3.5 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
      >
        {stage === 'intro' && 'Authenticate with passkey'}
        {stage === 'authenticating' && 'Waiting for device…'}
        {stage === 'restoring' && 'Restoring wallet…'}
      </button>

      {error && (
        <p className="text-[12px] text-bad">
          <span className="text-ink3">err:</span> {error}
        </p>
      )}
    </div>
  );
}
