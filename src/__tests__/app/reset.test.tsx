/**
 * ResetPage — DEV_ROUTES wipe chain: Credential → Auth → Wallet → router.replace('/').
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { render } from '@/__tests__/_helpers/intl';
import ResetPage from '@/app/reset/page';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';
import { deleteCredential } from '@/lib/crypto/storage';

const routerReplace = vi.fn();
const notFound = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  notFound: () => notFound(),
}));

vi.mock('@/lib/features', () => ({
  FEATURES: { DEV_ROUTES: true },
}));

vi.mock('@/lib/crypto/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crypto/storage')>();
  return { ...actual, deleteCredential: vi.fn().mockResolvedValue(undefined) };
});

beforeEach(() => {
  routerReplace.mockClear();
  notFound.mockClear();
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
  vi.mocked(deleteCredential).mockClear();
});

describe('ResetPage', () => {
  it('wipes credential, auth, wallet in order then redirects home', async () => {
    const deleteWallet = vi.fn().mockResolvedValue(undefined);
    useWalletStore.setState({ deleteWallet } as never);
    const resetAuth = vi.fn();
    useAuthStore.setState({ reset: resetAuth } as never);

    vi.mocked(deleteCredential).mockImplementation(async () => {
      expect(deleteWallet).not.toHaveBeenCalled();
      expect(resetAuth).not.toHaveBeenCalled();
    });
    resetAuth.mockImplementation(() => {
      expect(deleteCredential).toHaveBeenCalled();
      expect(deleteWallet).not.toHaveBeenCalled();
    });

    render(<ResetPage />);

    await waitFor(() => expect(deleteWallet).toHaveBeenCalled());
    expect(deleteCredential).toHaveBeenCalled();
    expect(resetAuth).toHaveBeenCalled();
    expect(vi.mocked(deleteCredential).mock.invocationCallOrder[0]).toBeLessThan(
      resetAuth.mock.invocationCallOrder[0],
    );
    expect(resetAuth.mock.invocationCallOrder[0]).toBeLessThan(
      deleteWallet.mock.invocationCallOrder[0],
    );
    expect(routerReplace).toHaveBeenCalledWith('/');
    expect(notFound).not.toHaveBeenCalled();
  });
});
