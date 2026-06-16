/**
 * Home unlock-screen reset escape hatch (`src/app/page.tsx`).
 *
 * The routing-priority branches are covered in `home.test.tsx`; this file
 * isolates the one remaining handler — `handleReset`, the escape hatch
 * passed to `<UnlockScreen onReset={...} />` for users stranded on the
 * unlock screen (forgotten password / passkey gone). It must wipe all
 * three surfaces: the encrypted wallet blob (via `deleteWallet`), the
 * passkey credential record (`deleteCredential`), and the auth-store
 * state (`resetAuth`).
 *
 * UnlockScreen is stubbed to a single button that invokes `onReset`
 * directly — its real reset UI (confirm dialog, password field) is
 * covered in `UnlockWallet.test.tsx`; here only the Home-level chain is
 * under test.
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

// The stubs are queried by role/name (no `data-testid`) so the
// button-inventory audit — which scans all of src/ including __tests__ —
// sees no orphan testids.
vi.mock('@/components/onboarding/UnlockScreen', () => ({
  UnlockScreen: ({ onReset }: { onReset: () => void }) => (
    <button aria-label="stub reset" onClick={onReset}>
      stub reset
    </button>
  ),
}));
vi.mock('@/components/onboarding/Onboarding', () => ({
  Onboarding: () => <div role="note">stub onboarding</div>,
}));
vi.mock('@/components/screens/WalletScreen', () => ({
  WalletScreen: () => <div role="note">stub wallet</div>,
}));

// Keep the real storage module — `deleteWallet` relies on the real
// `deleteEncryptedWallet`, and the test seeds a blob with the real
// `saveEncryptedWallet` — but spy on `deleteCredential` to assert the
// passkey leg of the reset chain fired.
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
    balance: null,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: false,
    storedAddress: null,
    storedAuthMethod: null,
    error: null,
  });
  useAuthStore.setState({ authMethod: 'seed', credentialId: 'cred-1', isHydrated: true });
  vi.spyOn(api, 'info').mockResolvedValue({ network: 'signet' });
  localStorage.clear();
});

describe('Home — unlock-screen reset escape hatch', () => {
  it('wipes the wallet blob, passkey credential, and auth state on reset', async () => {
    // Seed an encrypted blob so `checkForStoredWallet` flips the store into
    // the locked/has-stored-wallet state that renders <UnlockScreen />.
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
    // deleteWallet cleared the stored-wallet flags...
    expect(useWalletStore.getState().hasStoredWallet).toBe(false);
    expect(useWalletStore.getState().isLocked).toBe(false);
    // ...and resetAuth wiped the auth store identity.
    expect(useAuthStore.getState().authMethod).toBeNull();
  });
});
