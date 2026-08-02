/**
 * Multi-asset send surface is also fail-closed (same unavailable page).
 * Coverage: banner + disabled submit; no empty input_coins request.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/__tests__/_helpers/intl';
import SendPage from '@/app/send/page';
import { useWalletStore } from '@/stores/wallet';
import { useCapabilities } from '@/stores/capabilities';
import { api } from '@/lib/api/client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const ALICE = {
  address: 'a'.repeat(64),
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};

beforeEach(() => {
  useCapabilities.setState({
    capabilities: { address_list: false, username_claim: false, lnurl: false, multi_asset: true },
    loaded: true,
  });
  useWalletStore.setState({
    account: ALICE,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: true,
    storedAddress: ALICE.address,
    storedAuthMethod: 'seed',
    error: null,
  });
});

describe('SendPage multi-asset — not available yet', () => {
  it('shows unavailable banner under multi_asset:true', () => {
    const sendSpy = vi.spyOn(api, 'send');
    render(<SendPage />);
    expect(screen.getByTestId('send-unavailable-banner')).toBeInTheDocument();
    expect(screen.getByTestId('send-submit-btn')).toBeDisabled();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
