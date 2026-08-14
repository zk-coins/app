'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Check, CircleDollarSign, Wallet } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import {
  ApiError,
  JobFailedError,
  api,
  isCanonicalIssuanceAmount,
  parseIssuanceDecimals,
  type JobStatus,
} from '@/lib/api/client';
import { userMessageFor } from '@/lib/api/errorMessages';
import { formatAssetAmountString } from '@/lib/format';
import { useFeatures } from '@/lib/features';
import { useCapabilities } from '@/stores/capabilities';

function createLockKey(address: string): string {
  return `zkcoins.create.lock.${address}`;
}

/** Fail-closed: storage read error → treat as locked. */
function readCreateLock(address: string): boolean {
  try {
    return localStorage.getItem(createLockKey(address)) === '1';
  } catch {
    return true;
  }
}

/** Fail-closed: returns false when already locked or when storage access fails; caller must keep React state locked. */
function writeCreateLock(address: string): boolean {
  try {
    /* v8 ignore next -- already-locked is a TOCTOU duplicate of the create() readCreateLock guard */
    if (localStorage.getItem(createLockKey(address)) === '1') {
      return false; // already locked — do not start a second mint
    }
    localStorage.setItem(createLockKey(address), '1');
    return true;
  } catch {
    return false;
  }
}

function clearCreateLock(address: string): void {
  try {
    localStorage.removeItem(createLockKey(address));
  } catch {
    // ignore clear failures
  }
}

export default function CreateCoinPage() {
  const router = useRouter();
  const t = useTranslations('createCoin');
  const tErrors = useTranslations('errors');
  const account = useWalletStore((s) => s.account);
  const infoError = useNetworkStore((s) => s.infoError);
  const { MULTI_ASSET: multiAssetRuntime, loaded } = useFeatures();

  useEffect(() => {
    void useCapabilities.getState().fetch();
  }, []);

  // Runtime gate: a capability-adaptive bundle (build flag ON) talking to a
  // single-asset node has no create-coin flow — redirect home, mirroring the
  // `!account` redirect below. Wait for capabilities so fail-closed defaults
  // do not bounce before /v1/info lands. Do not redirect on infoError: fail-closed
  // multi_asset:false after a failed GET /v1/info is not "feature missing".
  useEffect(() => {
    if (
      loaded &&
      !multiAssetRuntime &&
      !infoError &&
      /* v8 ignore next -- This useEffect runs only after this client component mounts in a browser realm. */
      typeof window !== 'undefined'
    ) {
      router.replace('/');
    }
  }, [loaded, multiAssetRuntime, infoError, router]);

  // Redirect to home (which handles unlock) if no account in memory.
  useEffect(() => {
    if (
      !account &&
      /* v8 ignore next -- This useEffect runs only after this client component mounts in a browser realm. */
      typeof window !== 'undefined'
    ) {
      const id = setTimeout(() => {
        if (!useWalletStore.getState().account) router.replace('/');
      }, 100);
      return () => clearTimeout(id);
    }
  }, [account, router]);

  const [name, setName] = useState('');
  const [decimals, setDecimals] = useState('0');
  const [amount, setAmount] = useState('');
  const [creating, setCreating] = useState(() =>
    account ? readCreateLock(account.address) : false,
  );
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ name: string; amount: string; decimals: number } | null>(
    null,
  );
  const mintInFlight = useRef(false);

  // Restore remount lock from localStorage (survives Back navigation).
  useEffect(() => {
    if (!account) return;
    const lockKey = createLockKey(account.address);
    if (readCreateLock(account.address)) {
      setCreating(true);
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== lockKey) return;
      if (event.newValue === '1') {
        setCreating(true);
        return;
      }
      // Another tab cleared the lock. Do not unlock this tab mid-mint.
      if (mintInFlight.current) return;
      setCreating(false);
      mintInFlight.current = false;
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [account]);

  const create = useCallback(async () => {
    /* v8 ignore next -- The form and its submit callback unmount synchronously whenever account becomes null. */
    if (!account) return;
    if (mintInFlight.current || creating || readCreateLock(account.address)) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t('errInvalidName'));
      return;
    }
    const trimmedAmount = amount.trim();
    if (!trimmedAmount) {
      setError(t('errInvalidAmount'));
      return;
    }
    if (!isCanonicalIssuanceAmount(trimmedAmount)) {
      setError(t('errInvalidAmount'));
      return;
    }
    const dec = parseIssuanceDecimals(decimals);
    if (dec === null) {
      setError(t('errInvalidDecimals'));
      return;
    }
    if (!account.mnemonic || !account.nkCommit) {
      setError(t('errMissingSigningMaterial'));
      return;
    }

    setCreating(true);
    setPhase(null);
    setError(null);
    let keepCreatingLocked = false;
    if (!writeCreateLock(account.address)) {
      keepCreatingLocked = true;
      setError(t('errUnexpected'));
      mintInFlight.current = false;
      return;
    }
    mintInFlight.current = true;
    try {
      await api.createCoin(
        {
          account_address: account.address,
          name: trimmedName,
          decimals: dec,
          amount: trimmedAmount,
          mnemonic: account.mnemonic,
          nkCommit: account.nkCommit,
          accountIndex: 0,
        },
        { onPhase: (job: JobStatus) => setPhase(job.phase ?? null) },
      );
      clearCreateLock(account.address);
      setSuccess({ name: trimmedName, amount: trimmedAmount, decimals: dec });
    } catch (err) {
      const isProvenPreAdmit = err instanceof ApiError && !(err instanceof JobFailedError);
      const isDefiniteTerminalJob =
        err instanceof JobFailedError && (err.status === 'failed' || err.status === 'cancelled');
      if (!isProvenPreAdmit && !isDefiniteTerminalJob) {
        keepCreatingLocked = true;
      }
      if (err instanceof ApiError || err instanceof JobFailedError) {
        setError(userMessageFor(err, tErrors));
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t('errUnexpected'));
      }
    } finally {
      if (!keepCreatingLocked) {
        clearCreateLock(account.address);
        setCreating(false);
        mintInFlight.current = false;
      }
      setPhase(null);
    }
  }, [account, name, decimals, amount, creating, t, tErrors]);

  if (!account) {
    return (
      <AppShell showNav={false}>
        <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
          <Wallet size={36} strokeWidth={1.75} className="text-ink4" />
          <p data-testid="redirecting-placeholder" className="mt-4 text-[14px] text-ink2">
            {t('back')}
          </p>
        </div>
      </AppShell>
    );
  }

  if (success) {
    return (
      <AppShell showNav={false}>
        <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-bitcoin text-bg">
            <Check size={28} strokeWidth={2.5} />
          </div>
          <h1
            data-testid="create-success-heading"
            className="mt-6 text-[22px] font-bold tracking-tight text-ink"
          >
            {t('successHeading')}
          </h1>
          <p className="mt-2 text-[14px] text-ink2">
            {t('successBody', {
              amount: formatAssetAmountString(success.amount, success.decimals),
              name: success.name,
            })}
          </p>
          <button
            data-testid="create-done-btn"
            aria-label={t('done')}
            onClick={() => router.push('/')}
            className="mt-10 rounded-md bg-bitcoin px-8 py-3 text-[13px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover"
          >
            {t('done')}
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell showNav={false}>
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink3 transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} strokeWidth={2} />
          {t('back')}
        </Link>
        <span className="text-[11px] font-medium tracking-wider text-ink3 uppercase">
          {t('eyebrow')}
        </span>
      </header>

      <form
        className="mt-10 space-y-7"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-bitcoin/10 text-bitcoin">
            <CircleDollarSign size={18} strokeWidth={2} />
          </div>
          <div>
            <h1
              data-testid="create-heading"
              className="text-[26px] font-bold tracking-tight text-ink"
            >
              {t('heading')}
            </h1>
            <p className="mt-1 text-[13px] text-ink2">{t('subtitle')}</p>
          </div>
        </div>

        {/* Name */}
        <div>
          <label htmlFor="coin-name" className="mb-1.5 block text-[12px] font-medium text-ink2">
            {t('nameLabel')}
          </label>
          <input
            id="coin-name"
            data-testid="create-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('namePlaceholder')}
            className="w-full rounded-md border border-line2 bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
          />
        </div>

        {/* Decimals */}
        <div>
          <label htmlFor="coin-decimals" className="mb-1.5 block text-[12px] font-medium text-ink2">
            {t('decimalsLabel')}
          </label>
          <input
            id="coin-decimals"
            data-testid="create-decimals-input"
            type="text"
            inputMode="numeric"
            value={decimals}
            onChange={(e) => setDecimals(e.target.value.replace(/[^0-9]/g, ''))}
            spellCheck={false}
            autoComplete="off"
            placeholder="0"
            className="w-full rounded-md border border-line2 bg-surface px-4 py-3 mono text-[14px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
          />
        </div>

        {/* Amount */}
        <div>
          <label htmlFor="coin-amount" className="mb-1.5 block text-[12px] font-medium text-ink2">
            {t('amountLabel')}
          </label>
          <input
            id="coin-amount"
            data-testid="create-amount-input"
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => {
              const digitsOnly = e.target.value.replace(/[^0-9]/g, '');
              const normalized = digitsOnly.replace(/^0+(?=\d)/, '');
              setAmount(normalized);
            }}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('amountPlaceholder')}
            className="w-full rounded-md border border-line2 bg-surface px-4 py-3 mono text-[14px] text-ink placeholder:text-ink4 outline-none transition-colors focus:border-bitcoin"
          />
        </div>

        {error && (
          <p data-testid="create-error" className="text-[12px] text-bad">
            <span className="text-ink3">{t('errPrefix')}</span> {error}
          </p>
        )}

        <button
          type="submit"
          data-testid="create-submit-btn"
          disabled={creating || !name || !amount}
          className="w-full rounded-md bg-bitcoin py-4 text-[14px] font-semibold tracking-tight text-bg transition-colors hover:bg-bitcoin-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-ink4"
        >
          {creating ? t('creating') : t('submit')}
        </button>

        {creating && phase && (
          <p data-testid="create-phase" className="text-center text-[11px] text-ink3">
            {phase}
          </p>
        )}
      </form>
    </AppShell>
  );
}
