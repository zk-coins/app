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
import { useWalletStore, WALLET_PAYLOAD_VERSION } from '@/stores/wallet';
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

const originalDeleteWallet = useWalletStore.getState().deleteWallet;
const originalReset = useAuthStore.getState().reset;

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
    deleteWallet: originalDeleteWallet,
  });
  useAuthStore.setState({
    authMethod: 'seed',
    credentialId: 'cred-1',
    isHydrated: true,
    reset: originalReset,
  });
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
      payloadVersion: WALLET_PAYLOAD_VERSION,
    });

    // Credential/auth first; deleteWallet last so UnlockScreen stays mounted
    // until durable cleanup has finished.
    const realDeleteWallet = useWalletStore.getState().deleteWallet;
    const deleteWalletSpy = vi.fn(async () => {
      await realDeleteWallet();
    });
    useWalletStore.setState({ deleteWallet: deleteWalletSpy });
    const realReset = useAuthStore.getState().reset;
    const resetAuth = vi.fn(() => {
      expect(deleteCredential).toHaveBeenCalled();
      expect(deleteWalletSpy).not.toHaveBeenCalled();
      realReset();
    });
    useAuthStore.setState({ reset: resetAuth } as never);

    vi.mocked(deleteCredential).mockImplementation(async () => {
      expect(deleteWalletSpy).not.toHaveBeenCalled();
      expect(resetAuth).not.toHaveBeenCalled();
    });

    render(<Home />);
    await userEvent.click(await screen.findByRole('button', { name: 'stub reset' }));

    await waitFor(() => {
      expect(deleteCredential).toHaveBeenCalled();
    });
    expect(deleteWalletSpy).toHaveBeenCalled();
    expect(resetAuth).toHaveBeenCalled();
    expect(vi.mocked(deleteCredential).mock.invocationCallOrder[0]).toBeLessThan(
      resetAuth.mock.invocationCallOrder[0],
    );
    expect(resetAuth.mock.invocationCallOrder[0]).toBeLessThan(
      deleteWalletSpy.mock.invocationCallOrder[0],
    );
    expect(useWalletStore.getState().hasStoredWallet).toBe(false);
    expect(useWalletStore.getState().isLocked).toBe(false);
    expect(useAuthStore.getState().authMethod).toBeNull();
  });
});

describe('Home — storage error blocks onboarding stub', () => {
  it('shows storage-error and not the onboarding stub when IDB fails without account', async () => {
    const storage = await import('@/lib/crypto/storage');
    const loadSpy = vi
      .spyOn(storage, 'loadEncryptedWallet')
      .mockRejectedValue(new Error('IDB unavailable'));

    try {
      render(<Home />);

      expect(await screen.findByTestId('storage-error')).toHaveTextContent('IDB unavailable');
      expect(screen.queryByText('stub onboarding')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'stub discard' })).not.toBeInTheDocument();

      const callsBefore = loadSpy.mock.calls.length;
      await userEvent.click(screen.getByTestId('storage-error-retry'));
      await waitFor(() => {
        expect(loadSpy.mock.calls.length).toBeGreaterThan(callsBefore);
      });
    } finally {
      loadSpy.mockRestore();
    }
  });

  it('retry keeps storage-error mounted while the check is pending (no onboarding stub flash)', async () => {
    const storage = await import('@/lib/crypto/storage');
    let resolveSecond!: (v: null) => void;
    const loadSpy = vi.spyOn(storage, 'loadEncryptedWallet');
    loadSpy.mockRejectedValueOnce(new Error('IDB unavailable')).mockReturnValueOnce(
      new Promise<null>((res) => {
        resolveSecond = res;
      }),
    );

    try {
      render(<Home />);
      await screen.findByTestId('storage-error');

      await userEvent.click(screen.getByTestId('storage-error-retry'));

      expect(screen.getByTestId('storage-error')).toBeInTheDocument();
      expect(screen.queryByText('stub onboarding')).not.toBeInTheDocument();

      resolveSecond(null);
      await waitFor(() => {
        expect(screen.queryByTestId('storage-error')).not.toBeInTheDocument();
      });
    } finally {
      loadSpy.mockRestore();
    }
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

    // After hydrate, incompatible blob yields hasStoredWallet:false + needsSeedReimport:true.
    // Credential wipe still runs while reimport UI is visible; deleteWallet is last.
    const realDeleteWallet = useWalletStore.getState().deleteWallet;
    const deleteWalletSpy = vi.fn(async () => {
      await realDeleteWallet();
    });
    useWalletStore.setState({ deleteWallet: deleteWalletSpy });
    const realReset = useAuthStore.getState().reset;
    const resetAuth = vi.fn(() => {
      expect(deleteCredential).toHaveBeenCalled();
      expect(deleteWalletSpy).not.toHaveBeenCalled();
      realReset();
    });
    useAuthStore.setState({ reset: resetAuth } as never);

    vi.mocked(deleteCredential).mockImplementation(async () => {
      expect(useWalletStore.getState().needsSeedReimport).toBe(true);
      expect(deleteWalletSpy).not.toHaveBeenCalled();
      expect(resetAuth).not.toHaveBeenCalled();
    });

    render(<Home />);
    await userEvent.click(await screen.findByRole('button', { name: 'stub discard' }));

    await waitFor(() => {
      expect(deleteCredential).toHaveBeenCalled();
    });
    expect(deleteWalletSpy).toHaveBeenCalled();
    expect(resetAuth).toHaveBeenCalled();
    expect(vi.mocked(deleteCredential).mock.invocationCallOrder[0]).toBeLessThan(
      resetAuth.mock.invocationCallOrder[0],
    );
    expect(resetAuth.mock.invocationCallOrder[0]).toBeLessThan(
      deleteWalletSpy.mock.invocationCallOrder[0],
    );
    expect(useWalletStore.getState().hasStoredWallet).toBe(false);
    expect(useWalletStore.getState().needsSeedReimport).toBe(false);
    expect(useAuthStore.getState().authMethod).toBeNull();
  });
});
