'use client';

import { useWalletStore } from '@/stores/wallet';

export function TransactionLog() {
  const { transactions } = useWalletStore();

  if (transactions.length === 0) {
    return (
      <div className="rounded-xl border border-zkcoins-border bg-zkcoins-card p-6 text-center">
        <p className="text-sm text-zkcoins-muted">No transactions yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zkcoins-border bg-zkcoins-card p-6">
      <h3 className="mb-4 text-sm font-semibold text-white">Transactions</h3>
      <div className="space-y-3">
        {transactions.map((tx) => (
          <div
            key={tx.id}
            className="flex items-center justify-between rounded-lg bg-zkcoins-bg p-3"
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                  tx.type === 'send'
                    ? 'bg-red-900/30 text-red-400'
                    : tx.type === 'mint'
                      ? 'bg-yellow-900/30 text-yellow-400'
                      : 'bg-green-900/30 text-green-400'
                }`}
              >
                {tx.type === 'send' ? '-' : '+'}
              </div>
              <div>
                <p className="text-sm text-white">
                  {tx.type === 'mint' ? 'Faucet' : tx.type === 'send' ? 'Sent' : 'Received'}
                </p>
                <p className="text-xs text-zkcoins-muted">
                  {new Date(tx.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
            <span
              className={`text-sm font-semibold ${tx.type === 'send' ? 'text-red-400' : 'text-green-400'}`}
            >
              {tx.type === 'send' ? '-' : '+'}
              {tx.amount.toLocaleString()} sats
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
