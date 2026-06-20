'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Check, CircleDollarSign, Wallet } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';
import { ApiError, JobFailedError, api, type JobStatus } from '@/lib/api/client';
import { userMessageFor } from '@/lib/api/errorMessages';
import { formatAssetAmount } from '@/lib/format';
import { useFeatures } from '@/lib/features';

const MAX_DECIMALS = 18;

export default function CreateCoinPage() {
  const router = useRouter();
  const t = useTranslations('createCoin');
  const tErrors = useTranslations('errors');
  const account = useWalletStore((s) => s.account);
  const { MULTI_ASSET: multiAssetRuntime } = useFeatures();

  // Runtime gate: a capability-adaptive bundle (build flag ON) talking to a
  // single-asset node has no create-coin flow — redirect home, mirroring the
  // `!account` redirect below.
  useEffect(() => {
    if (!multiAssetRuntime && typeof window !== 'undefined') {
      router.replace('/');
    }
  }, [multiAssetRuntime, router]);

  // Redirect to home (which handles unlock) if no account in memory.
  useEffect(() => {
    if (!account && typeof window !== 'undefined') {
      const id = setTimeout(() => {
        if (!useWalletStore.getState().account) router.replace('/');
      }, 100);
      return () => clearTimeout(id);
    }
  }, [account, router]);

  const [name, setName] = useState('');
  const [decimals, setDecimals] = useState('0');
  const [amount, setAmount] = useState('');
  const [creating, setCreating] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ name: string; amount: number; decimals: number } | null>(
    null,
  );

  const create = useCallback(async () => {
    if (!account) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t('errInvalidName'));
      return;
    }
    const dec = Number(decimals);
    if (!Number.isInteger(dec) || dec < 0 || dec > MAX_DECIMALS) {
      setError(t('errInvalidDecimals'));
      return;
    }
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) {
      setError(t('errInvalidAmount'));
      return;
    }
    if (!account.xpriv) {
      setError(t('errInvalidName'));
      return;
    }

    setCreating(true);
    setPhase(null);
    setError(null);
    try {
      await api.createCoin(
        {
          account_address: account.address,
          name: trimmedName,
          decimals: dec,
          amount: amt,
          xpriv: account.xpriv,
        },
        { onPhase: (job: JobStatus) => setPhase(job.phase) },
      );
      setSuccess({ name: trimmedName, amount: amt, decimals: dec });
    } catch (err) {
      if (err instanceof ApiError || err instanceof JobFailedError) {
        setError(userMessageFor(err, tErrors));
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t('errInvalidAmount'));
      }
    } finally {
      setCreating(false);
      setPhase(null);
    }
  }, [account, name, decimals, amount, t, tErrors]);

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
              amount: formatAssetAmount(success.amount, success.decimals),
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
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
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
