'use client';

export function Header() {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-bitcoin font-bold text-black">
          zk
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">zkCoins</h1>
          <p className="text-xs text-zkcoins-muted">Shielded CSV Wallet</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-yellow-900/30 px-2.5 py-0.5 text-xs text-yellow-400">
          Testnet
        </span>
      </div>
    </header>
  );
}
