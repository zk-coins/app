'use client';

import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  Receipt,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useWalletStore } from '@/stores/wallet';
import { useNetworkStore } from '@/stores/network';
import { useTransaction } from '@/hooks/useTransaction';
import { historyItemDate, type TxDetail } from '@/lib/api/client';
import { formatBtc, formatBtcCompact, truncateAddress, toZkAddress } from '@/lib/format';

// Block explorer base (build-time, like the network-activity chart).
// Empty in dev / PRD bundles that ship no explorer yet → no outbound link,
// the raw txid stays the on-chain reference.
const EXPLORER_URL = (process.env.NEXT_PUBLIC_EXPLORER_URL ?? '').replace(/\/$/, '');

export default function TransactionDetailPage() {
  const params = useParams<{ id: string }>();
  const account = useWalletStore((s) => s.account);
  const usernameDomain = useNetworkStore((s) => s.usernameDomain);

  // Route param is a pull-session record id (string). Empty / missing → no fetch.
  const rawId = params.id;
  const id = typeof rawId === 'string' && rawId.length > 0 ? rawId : null;

  const txAccount =
    account && account.mnemonic && account.nkCommit
      ? { address: account.address, mnemonic: account.mnemonic, nkCommit: account.nkCommit }
      : undefined;

  const { detail, loading, error } = useTransaction(id, txAccount);

  return (
    <AppShell showNav={false}>
      <header className="flex items-center justify-between">
        <Link
          href="/"
          data-testid="tx-detail-back"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink3 transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} strokeWidth={2} />
          Back
        </Link>
        <span className="text-[11px] font-medium tracking-wider text-ink3 uppercase">
          Transaction
        </span>
      </header>

      {loading ? (
        <TxDetailLoading />
      ) : detail ? (
        <TxDetailBody detail={detail} usernameDomain={usernameDomain} />
      ) : (
        // No detail + not loading ⇒ the hook set `error` to one of the two
        // terminal kinds (404 / bad inputs → not_found, else → error).
        <TxDetailMissing kind={error === 'not_found' ? 'not_found' : 'error'} />
      )}
    </AppShell>
  );
}

function TxDetailLoading() {
  return (
    <div
      data-testid="tx-detail-loading"
      className="flex min-h-[60vh] flex-col items-center justify-center text-center"
    >
      <Receipt size={28} strokeWidth={1.75} className="animate-pulse text-ink4" />
      <p className="mt-4 text-[13px] text-ink3">Loading transaction…</p>
    </div>
  );
}

function TxDetailMissing({ kind }: { kind: 'not_found' | 'error' }) {
  return (
    <div
      data-testid="tx-detail-missing"
      className="flex min-h-[60vh] flex-col items-center justify-center text-center"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-ink4">
        <Receipt size={22} strokeWidth={1.75} />
      </div>
      <p className="mt-4 text-[15px] font-semibold text-ink">
        {kind === 'not_found' ? 'Transaction not found' : 'Could not load transaction'}
      </p>
      <p className="mt-1 max-w-[280px] text-[13px] leading-relaxed text-ink3">
        {kind === 'not_found'
          ? 'It may belong to a different wallet, or it no longer exists on this node.'
          : 'The node could not be reached. Go back and open it again.'}
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md bg-bitcoin px-6 py-2.5 text-[13px] font-semibold text-bg transition-colors hover:bg-bitcoin-hover"
      >
        Back to wallet
      </Link>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'border-bitcoin/40 bg-bitcoin/10 text-bitcoin',
  completed: 'border-bitcoin/40 bg-bitcoin/10 text-bitcoin',
  pending: 'border-line2 bg-surface text-ink2',
  failed: 'border-bad/40 bg-bad/10 text-bad',
};

function TxDetailBody({ detail, usernameDomain }: { detail: TxDetail; usernameDomain: string }) {
  const kind = detail.kind;
  const positive = kind !== 'send';
  const label = kind === 'mint' ? 'Faucet' : kind === 'send' ? 'Sent' : 'Received';
  const HeroIcon = kind === 'send' ? ArrowUpRight : kind === 'mint' ? Plus : ArrowDownLeft;

  const explorerHref = EXPLORER_URL && detail.txid ? `${EXPLORER_URL}/tx/${detail.txid}` : null;
  const accountAddr = detail.address ?? '';
  const zkAddress = accountAddr ? toZkAddress(accountAddr, usernameDomain) : '';
  // `confirmed` / `completed` mean the proof path finished successfully.
  const verified = detail.status === 'confirmed' || detail.status === 'completed';
  const amount = typeof detail.amount === 'number' ? detail.amount : undefined;
  const status = detail.status ?? 'pending';
  const statusClass = STATUS_STYLES[status] ?? STATUS_STYLES.pending;

  return (
    <section data-testid="tx-detail-body" className="mt-8 space-y-8">
      {/* Hero — kind, signed amount, status */}
      <div className="flex flex-col items-center text-center">
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-full ${
            positive ? 'bg-line text-ink2' : 'bg-bitcoin/10 text-bitcoin'
          }`}
        >
          <HeroIcon size={24} strokeWidth={2.25} />
        </div>
        <p data-testid="tx-detail-label" className="mt-3 text-[13px] font-medium text-ink3">
          {label}
        </p>
        <p
          data-testid="tx-detail-v-amount"
          className={`mt-1 mono text-[28px] font-bold tabular-nums ${
            positive ? 'text-ink' : 'text-bitcoin'
          }`}
        >
          {amount === undefined ? '—' : `${formatBtcCompact(positive ? amount : -amount)} BTC`}
        </p>
        <span
          data-testid="tx-detail-status"
          className={`mt-3 rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${statusClass}`}
        >
          {status}
        </span>
      </div>

      {/* Overview */}
      <Section title="Overview">
        <Row label="Direction" value={label} testid="tx-detail-direction" />
        <Row
          label="Date"
          value={formatFullTimestamp(historyItemDate(detail))}
          testid="tx-detail-v-time"
        />
        <Row label="Account" testid="tx-detail-account">
          <span className="mono text-[12px] text-ink2">
            {zkAddress || (accountAddr ? truncateAddress(accountAddr) : '—')}
          </span>
        </Row>
        <Row label="Reference" value={`#${detail.id}`} mono testid="tx-detail-v-id" />
      </Section>

      {/* Amounts */}
      <Section title="Amounts">
        <Row
          label="Amount"
          value={amount === undefined ? '—' : `${formatBtc(amount)} BTC`}
          mono
          testid="tx-detail-v-amount-full"
        />
        <Row
          label="Balance after"
          value={
            typeof detail.balance_after === 'number'
              ? `${formatBtc(detail.balance_after)} BTC`
              : '—'
          }
          mono
          testid="tx-detail-v-balance-after"
        />
        <Row
          label="Balance before"
          value={
            typeof detail.balance_before === 'number'
              ? `${formatBtc(detail.balance_before)} BTC`
              : '—'
          }
          mono
          testid="tx-detail-v-balance-before"
        />
        <Row
          label="Send counter"
          value={typeof detail.num_sends_after === 'number' ? String(detail.num_sends_after) : '—'}
          mono
          testid="tx-detail-v-num-sends"
        />
      </Section>

      {/* Proof & verification */}
      <Section title="Proof & verification">
        <Row label="Verification" testid="tx-detail-verification">
          {verified ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-bitcoin">
              <ShieldCheck size={13} strokeWidth={2.25} /> Proof verified
            </span>
          ) : (
            <span className="text-[12px] text-ink3">Awaiting confirmation</span>
          )}
        </Row>
        <Row
          label="Circuit digest"
          value={detail.circuit_digest ? truncateAddress(detail.circuit_digest) : '—'}
          mono
          testid="tx-detail-v-circuit-digest"
        />
        <Row
          label="Commitment key"
          value={detail.commitment_public_key ? truncateAddress(detail.commitment_public_key) : '—'}
          mono
          testid="tx-detail-v-commitment-key"
        />
      </Section>

      {/* On-chain */}
      <Section title="On-chain">
        <Row label="Commit txid" testid="tx-detail-txid">
          {detail.txid ? (
            explorerHref ? (
              <a
                href={explorerHref}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="tx-detail-explorer-link"
                className="inline-flex items-center gap-1 mono text-[12px] text-bitcoin hover:underline"
              >
                <span data-testid="tx-detail-v-txid">{truncateAddress(detail.txid)}</span>
                <ExternalLink size={11} strokeWidth={2} />
              </a>
            ) : (
              <span data-testid="tx-detail-v-txid" className="mono text-[12px] text-ink2">
                {truncateAddress(detail.txid)}
              </span>
            )
          ) : (
            <span className="text-[12px] text-ink3">Not yet broadcast</span>
          )}
        </Row>
        <Row
          label="Block height"
          value={typeof detail.block_height === 'number' ? String(detail.block_height) : '—'}
          mono
          testid="tx-detail-v-block-height"
        />
        <Row
          label="Commit value"
          value={
            typeof detail.commit_output_value === 'number'
              ? `${formatBtc(detail.commit_output_value)} BTC`
              : '—'
          }
          mono
          testid="tx-detail-v-commit-value"
        />
      </Section>

      {/* Privacy */}
      <Section title="Privacy">
        <Row label="Counterparty" testid="tx-detail-counterparty">
          <span className="text-[12px] text-ink3">{detail.counterparty ?? 'Private'}</span>
        </Row>
        <Row label="Memo" value={detail.memo ?? '—'} testid="tx-detail-memo" />
        <Row label="Source" value="Your node" testid="tx-detail-source" />
      </Section>
    </section>
  );
}

/** Full local date + time from an already-parsed Date. */
function formatFullTimestamp(date: Date): string {
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-ink3 uppercase">{title}</h2>
      <dl className="divide-y divide-line rounded-md border border-line bg-surface px-4">
        {children}
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  children,
  mono,
  testid,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
  mono?: boolean;
  testid?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="shrink-0 text-[12px] text-ink3">{label}</dt>
      {/* testid sits on the value cell, not the row, so a golden can mask
          the volatile value while the label stays visible. */}
      <dd className="min-w-0 truncate text-right" data-testid={testid}>
        {children ?? (
          <span className={`text-[12px] text-ink ${mono ? 'mono tabular-nums' : ''}`}>{value}</span>
        )}
      </dd>
    </div>
  );
}
