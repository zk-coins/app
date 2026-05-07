import type { Transaction } from '@/stores/wallet';

const SAMPLE_RECIPIENTS = [
  'zs1qq8x0fhuabcdef1234567890abcdef0123',
  'zs1pp2acvbfgh4567ijklmnopqrstuvwx7890',
  'zs1xy9mn2pqe890abcdef1234567890abcd56',
  'zs1mz3kl4rstuvw5678ijklmnop1234abcd78',
  'zs1ab7cd5efgh1234ijklmn89opqr5678st90',
];

const SAMPLE_AMOUNTS_RECEIVE = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000];
const SAMPLE_AMOUNTS_SEND = [5_000, 12_000, 30_000, 75_000, 150_000];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hex(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/** Generate one random transaction (timestamp = now). */
export function randomTransaction(): Transaction {
  const r = Math.random();
  let type: Transaction['type'];
  let amount: number;
  if (r < 0.55) {
    type = 'receive';
    amount = pick(SAMPLE_AMOUNTS_RECEIVE);
  } else if (r < 0.9) {
    type = 'send';
    amount = pick(SAMPLE_AMOUNTS_SEND);
  } else {
    type = 'mint';
    amount = 10_000;
  }
  return {
    id: `${type}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    type,
    amount,
    counterparty: type === 'send' ? pick(SAMPLE_RECIPIENTS) : undefined,
    timestamp: Date.now(),
    proofId: hex(8),
  };
}

/** A realistic mock history spread over the past ~24 hours, plus the resulting balance in sats. */
export function populateDemoHistory(): { transactions: Transaction[]; balance: number } {
  const now = Date.now();
  const offsets = [
    5 * 60_000,
    25 * 60_000,
    55 * 60_000,
    2 * 3_600_000,
    4 * 3_600_000,
    8 * 3_600_000,
    14 * 3_600_000,
    22 * 3_600_000,
  ];

  // Pre-rolled fixed history so the simulated wallet looks the same on each /simulate visit.
  const fixed: Transaction[] = [
    { id: 'sim-1', type: 'mint', amount: 10_000, timestamp: now - offsets[7], proofId: '4a2b1c8d' },
    {
      id: 'sim-2',
      type: 'receive',
      amount: 250_000,
      timestamp: now - offsets[6],
      proofId: '7d8e2a9f',
    },
    {
      id: 'sim-3',
      type: 'send',
      amount: 30_000,
      timestamp: now - offsets[5],
      proofId: '9c4d3e1a',
      counterparty: SAMPLE_RECIPIENTS[0],
    },
    {
      id: 'sim-4',
      type: 'receive',
      amount: 500_000,
      timestamp: now - offsets[4],
      proofId: '2e8a5c7b',
    },
    {
      id: 'sim-5',
      type: 'send',
      amount: 75_000,
      timestamp: now - offsets[3],
      proofId: '6b1f9e3c',
      counterparty: SAMPLE_RECIPIENTS[1],
    },
    {
      id: 'sim-6',
      type: 'receive',
      amount: 100_000,
      timestamp: now - offsets[2],
      proofId: '5d3a8f2e',
    },
    {
      id: 'sim-7',
      type: 'send',
      amount: 12_000,
      timestamp: now - offsets[1],
      proofId: '8e7c4b1a',
      counterparty: SAMPLE_RECIPIENTS[2],
    },
    {
      id: 'sim-8',
      type: 'receive',
      amount: 50_000,
      timestamp: now - offsets[0],
      proofId: '3a9d6e8c',
    },
  ];

  // Newest first in the store; current balance derived from the sum.
  const transactions = [...fixed].reverse();
  const balance = fixed.reduce((acc, tx) => acc + (tx.type === 'send' ? -tx.amount : tx.amount), 0);

  return { transactions, balance: Math.max(0, balance) };
}
