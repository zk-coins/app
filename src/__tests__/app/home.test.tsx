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
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/__tests__/_helpers/intl';
import Home from '@/app/page';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api/client';

const FEATURES_STATE = vi.hoisted(() => ({
  APPS_DIRECTORY: false,
  PASSKEY: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
  USERNAME_CLAIM: false,
  // Runtime multi-asset capability ON: WalletScreen then renders the
  // per-asset portfolio + create-coin entry these tests assert on.
  MULTI_ASSET: true,
}));
// Home renders WalletScreen on the unlocked branch; WalletScreen
// reads runtime capabilities via `useFeatures()`. The mock must
// expose both the build-time `FEATURES` export AND the `useFeatures`
// hook so the merged features-module shape works.
vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

let mockPathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const ALICE = {
  address: 'a'.repeat(64),
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};

beforeEach(() => {
  Object.assign(FEATURES_STATE, {
    APPS_DIRECTORY: false,
    PASSKEY: false,
    DEV_ROUTES: false,
    AUTO_LOCK: false,
    ADDRESS_ROTATION: false,
    TOR_ROUTING: false,
    USERNAME_CLAIM: false,
    MULTI_ASSET: true,
  });
  mockPathname = '/';
  useWalletStore.setState({
    account: null,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    needsSeedReimport: false,
    error: null,
  });
  useAuthStore.setState({ authMethod: null, credentialId: null, isHydrated: false });
  localStorage.clear();
  // WalletScreen + UnlockScreen both fire api.info / api.balance on mount;
  // WalletScreen's useHistory additionally fires api.getHistory.
  // Stub them so the routing assertions don't race the network layer.
  vi.spyOn(api, 'info').mockResolvedValue({
    network: 'testnet',
    protocol_version: 'v1',
    features: ['wallet'],
  });
  vi.spyOn(api, 'ownerBalances').mockResolvedValue({ address: ALICE.address, assets: [] });
  vi.spyOn(api, 'getHistory').mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
});

describe('Home — onboarding branch (no stored wallet, no account)', () => {
  it('renders <Onboarding /> when both hydration calls find nothing', async () => {
    render(<Home />);
    expect(await screen.findByTestId('welcome-heading')).toBeInTheDocument();
    // Neither of the other two top-level surfaces should render.
    expect(screen.queryByTestId('unlock-heading')).not.toBeInTheDocument();
  });
});

describe('Home — legacy reimport branch', () => {
  it('keeps legacy data and shows reimport guidance instead of plain create', async () => {
    localStorage.setItem(
      'zkcoins_wallet',
      JSON.stringify({ account: { address: ALICE.address, xpriv: 'xprv…', numPubkeys: 0 } }),
    );

    render(<Home />);
    expect(await screen.findByTestId('seed-reimport-required')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-create-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('onboarding-restore-btn')).toBeInTheDocument();
    // Legacy blob must still be present until re-import or discard.
    expect(localStorage.getItem('zkcoins_wallet')).not.toBeNull();
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
    expect(screen.getByTestId('create-coin-btn')).toBeInTheDocument();
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
