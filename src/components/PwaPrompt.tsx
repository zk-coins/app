'use client';

import { useEffect, useState } from 'react';
import { Home, X, Download, Share } from 'lucide-react';

const KEY = 'zkcoins_pwa_prompt_dismissed';

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Mode =
  | { kind: 'native'; event: BIPEvent } // Chrome/Edge/Android — programmatic install
  | { kind: 'ios' } // iOS Safari — share-icon manual instructions
  | { kind: 'manual'; body: string }; // Desktop without BIP — show address-bar hint

function detectMode(): Mode {
  if (typeof window === 'undefined') {
    return { kind: 'manual', body: 'Install zkCoins for the smoothest experience.' };
  }
  const ua = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  const isSafari = /safari/.test(ua) && !/chrome|crios|fxios/.test(ua);
  const isAndroid = /android/.test(ua);

  if (isIos && isSafari) return { kind: 'ios' };
  if (isAndroid) {
    return {
      kind: 'manual',
      body: "Tap the menu icon, then 'Add to Home screen' or 'Install app'.",
    };
  }
  return {
    kind: 'manual',
    body: "Click the install icon in your browser's address bar — keys stay on this device.",
  };
}

export function PwaPrompt() {
  const [dismissed, setDismissed] = useState(true);
  const [installed, setInstalled] = useState(false);
  const [mode, setMode] = useState<Mode>(() => detectMode());
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDismissed(localStorage.getItem(KEY) === '1');
    setInstalled(
      window.matchMedia?.('(display-mode: standalone)').matches ||
        // @ts-expect-error iOS legacy
        window.navigator.standalone === true,
    );

    setMode(detectMode());

    // Capture the install prompt event so we can call .prompt() later.
    const onBIP = (e: Event) => {
      e.preventDefault();
      setMode({ kind: 'native', event: e as BIPEvent });
    };
    window.addEventListener('beforeinstallprompt', onBIP);

    const onInstalled = () => {
      setInstalled(true);
      // Clean up local hint flag — no longer needed once installed.
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(KEY, '1');
    }
  };

  const install = async () => {
    if (mode.kind !== 'native') return;
    setInstalling(true);
    try {
      await mode.event.prompt();
      const choice = await mode.event.userChoice;
      if (choice.outcome === 'accepted') {
        // 'appinstalled' will fire shortly and flip `installed`.
      } else {
        dismiss();
      }
    } catch {
      // User cancelled, browser blocked, etc. — non-fatal.
    } finally {
      setInstalling(false);
    }
  };

  if (installed || dismissed) return null;

  // iOS Safari: show share-icon instructions
  if (mode.kind === 'ios') {
    return (
      <Card onDismiss={dismiss}>
        <p className="text-[12px] font-semibold text-ink">Add zkCoins to your home screen</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink3">
          Tap the{' '}
          <span className="inline-flex items-center align-text-bottom">
            <Share size={11} strokeWidth={2} className="mx-0.5" />
          </span>
          share icon in Safari&apos;s toolbar, then &ldquo;Add to Home Screen&rdquo;.
        </p>
      </Card>
    );
  }

  // Native install available — show button
  if (mode.kind === 'native') {
    return (
      <Card onDismiss={dismiss}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-ink">Install zkCoins as an app</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink3">
              Faster launch, native-feel UI, keys stay on this device.
            </p>
          </div>
          <button
            onClick={install}
            disabled={installing}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-bitcoin px-3 py-1.5 text-[11px] font-semibold tracking-wide text-bg transition-colors hover:bg-bitcoin-hover disabled:opacity-50"
          >
            <Download size={12} strokeWidth={2.25} />
            {installing ? 'Installing…' : 'Install'}
          </button>
        </div>
      </Card>
    );
  }

  // Manual fallback — instructions only
  return (
    <Card onDismiss={dismiss}>
      <p className="text-[12px] font-semibold text-ink">Install zkCoins as an app</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-ink3">{mode.body}</p>
    </Card>
  );
}

function Card({ onDismiss, children }: { onDismiss: () => void; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-line bg-surface px-3 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bitcoin/10 text-bitcoin">
        <Home size={14} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      <button
        onClick={onDismiss}
        className="shrink-0 self-start rounded-sm p-1 text-ink3 transition-colors hover:text-ink"
        aria-label="Dismiss"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
