/**
 * Home escape-hatch handlers (`src/app/page.tsx`):
 * - `handleReset` on UnlockScreen (forgotten password / passkey gone)
 * - `handleDiscardLegacy` on Onboarding when needsSeedReimport
 *
 * Child screens are stubbed to single buttons that invoke the props —
 * their real UI is covered elsewhere.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
import Home from '@/app/page';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api/client';
import { deleteCredential } from '@/lib/crypto/storage';

vi.mock('@/components/onboarding/UnlockScreen', () => ({
  UnlockScreen: ({ onReset }: { onReset: () => void }) => (
    <button aria-label="stub reset" onClick={onReset}>
      stub reset
    </button>
  ),
}));
vi.mock('@/components/onboarding/Onboarding', () => ({
  Onboarding: ({
    onDiscardLegacy,
    reimportRequired,
  }: {
    onDiscardLegacy?: () => void | Promise<void>;
    reimportRequired?: boolean;
  }) => (
    <div role="note">
      {reimportRequired ? (
        <button aria-label="stub discard" onClick={() => void onDiscardLegacy?.()}>
          stub discard
        </button>
      ) : (
        'stub onboarding'
      )}
    </div>
  ),
}));
vi.mock('@/components/screens/WalletScreen', () => ({
  WalletScreen: () => <div role="note">stub wallet</div>,
}));

vi.mock('@/lib/crypto/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crypto/storage')>();
  return { ...actual, deleteCredential: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const ALICE_ADDRESS = 'a'.repeat(64);

beforeEach(() => {
  useWalletStore.setState({
    account: null,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    error: null,
    needsSeedReimport: false,
  });
  useAuthStore.setState({ authMethod: 'seed', credentialId: 'cred-1', isHydrated: true });
  vi.spyOn(api, 'info').mockResolvedValue({
    network: 'testnet',
    protocol_version: 'v1',
    features: ['wallet'],
  });
  vi.mocked(deleteCredential).mockClear();
  localStorage.clear();
});

describe('Home — unlock-screen reset escape hatch', () => {
  it('wipes the wallet blob, passkey credential, and auth state on reset', async () => {
    const { saveEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'ct', iv: 'iv', salt: 'salt' },
      authMethod: 'seed',
      address: ALICE_ADDRESS,
      createdAt: Date.now(),
    });

    render(<Home />);
    await userEvent.click(await screen.findByRole('button', { name: 'stub reset' }));

    await waitFor(() => {
      expect(deleteCredential).toHaveBeenCalled();
    });
    expect(useWalletStore.getState().hasStoredWallet).toBe(false);
    expect(useWalletStore.getState().isLocked).toBe(false);
    expect(useAuthStore.getState().authMethod).toBeNull();
  });
});

describe('Home — legacy reimport discard', () => {
  it('handleDiscardLegacy wipes wallet, credential, auth, and clears reimport flag', async () => {
    const { saveEncryptedWallet } = await import('@/lib/crypto/storage');
    await saveEncryptedWallet({
      encrypted: { ciphertext: 'ct', iv: 'iv', salt: 'salt' },
      authMethod: 'seed',
      address: ALICE_ADDRESS,
      createdAt: Date.now(),
    });
    useWalletStore.setState({
      account: null,
      isLocked: true,
      hasStoredWallet: true,
      needsSeedReimport: true,
      storedAuthMethod: 'seed',
      storedAddress: ALICE_ADDRESS,
    });

    render(<Home />);
    await userEvent.click(await screen.findByRole('button', { name: 'stub discard' }));

    await waitFor(() => {
      expect(deleteCredential).toHaveBeenCalled();
    });
    expect(useWalletStore.getState().hasStoredWallet).toBe(false);
    expect(useWalletStore.getState().needsSeedReimport).toBe(false);
    expect(useAuthStore.getState().authMethod).toBeNull();
  });
});
