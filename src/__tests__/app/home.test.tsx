/**
 * Routing logic in `src/app/page.tsx` (the Home component).
 *
 * Home decides which of the three top-level screens renders:
 *   - `<Onboarding />` — no stored wallet
 *   - `<UnlockScreen />` — stored wallet exists and the wallet store
 *     is locked
 *   - `<WalletScreen />` (wrapped in AppShell) — account is in memory
 *     and unlocked
 *
 * Before hydration (`checkForStoredWallet` + `hydrate` pending) the
 * component returns `null` so the SSR/CSR boundary doesn't flash the
 * wrong screen. Each gate has to be exercised independently — a
 * regression that flipped the priority would silently leave a user
 * either looking at Onboarding while their wallet exists or at
 * UnlockScreen while their account is already in memory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Home from '@/app/page';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api/client';

const FEATURES_STATE = vi.hoisted(() => ({
  USERNAMES: false,
  APPS_DIRECTORY: false,
  PASSKEY: false,
  FAUCET: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
}));
vi.mock('@/lib/features', () => ({ FEATURES: FEATURES_STATE }));

let mockPathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const ALICE = {
  address: 'a'.repeat(64),
  numPubkeys: 0,
  xpriv: 'xprv9s21ZrQH143K3GJpoapnV8SFfuZcECe',
};

beforeEach(() => {
  Object.assign(FEATURES_STATE, {
    USERNAMES: false,
    APPS_DIRECTORY: false,
    PASSKEY: false,
    FAUCET: false,
    DEV_ROUTES: false,
    AUTO_LOCK: false,
    ADDRESS_ROTATION: false,
    TOR_ROUTING: false,
  });
  mockPathname = '/';
  useWalletStore.setState({
    account: null,
    balance: null,
    transactions: [],
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    error: null,
  });
  useAuthStore.setState({ authMethod: null, credentialId: null, isHydrated: false });
  localStorage.clear();
  // WalletScreen + UnlockScreen both fire api.info / api.balance on mount.
  // Stub them so the routing assertions don't race the network layer.
  vi.spyOn(api, 'info').mockResolvedValue({ network: 'signet' });
  vi.spyOn(api, 'balance').mockResolvedValue({ balance: 0 });
});

describe('Home — onboarding branch (no stored wallet, no account)', () => {
  it('renders <Onboarding /> when both hydration calls find nothing', async () => {
    render(<Home />);
    expect(await screen.findByTestId('welcome-heading')).toBeInTheDocument();
    // Neither of the other two top-level surfaces should render.
    expect(screen.queryByTestId('unlock-heading')).not.toBeInTheDocument();
  });
});

describe('Home — unlock branch (stored wallet, locked)', () => {
  it('renders <UnlockScreen /> when checkForStoredWallet finds an encrypted blob', async () => {
    // Pre-seed IndexedDB with an encrypted wallet so checkForStoredWallet
    // flips `hasStoredWallet=true` + `isLocked=true` on mount.
    const { saveEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'ct', iv: 'iv', salt: 'salt' },
      authMethod: 'seed',
      address: ALICE.address,
      createdAt: Date.now(),
    });

    render(<Home />);
    expect(await screen.findByTestId('unlock-heading')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-heading')).not.toBeInTheDocument();
  });
});

describe('Home — wallet branch (account in memory)', () => {
  it('renders <WalletScreen /> when an unlocked account is already in the store', async () => {
    useWalletStore.setState({ account: ALICE, isLocked: false });
    render(<Home />);
    // WalletScreen is wrapped in AppShell — assert on the BottomNav
    // which only AppShell renders, plus a WalletScreen-only testid.
    await waitFor(() => {
      expect(screen.getByTestId('nav-wallet')).toBeInTheDocument();
    });
    expect(screen.getByTestId('balance-value')).toBeInTheDocument();
  });
});

describe('Home — branch priority', () => {
  it('prefers the wallet branch over the unlock branch when both gates would match', async () => {
    // Both `account` is set AND a stored blob exists (the post-unlock
    // state). The wallet branch wins because `account && !isLocked`
    // is evaluated first.
    const { saveEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'ct', iv: 'iv', salt: 'salt' },
      authMethod: 'seed',
      address: ALICE.address,
      createdAt: Date.now(),
    });
    useWalletStore.setState({ account: ALICE, isLocked: false });

    render(<Home />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-wallet')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('unlock-heading')).not.toBeInTheDocument();
  });

  it('stays on the unlock branch when account is null but hasStoredWallet is true', async () => {
    const { saveEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'ct', iv: 'iv', salt: 'salt' },
      authMethod: 'passkey',
      address: ALICE.address,
      createdAt: Date.now(),
    });
    render(<Home />);
    expect(await screen.findByTestId('unlock-heading')).toBeInTheDocument();
  });
});
