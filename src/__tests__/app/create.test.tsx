/**
 * CreateCoinPage (`src/app/create/page.tsx`) — the create-coin flow that
 * replaced the testnet faucet.
 *
 * Covers: the redirect guard (no account), field validation (name,
 * decimals, amount), the happy-path two-phase mint → success screen, and
 * the error-surfacing branch (JobFailedError → translated message).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
import CreateCoinPage from '@/app/create/page';
import { useWalletStore } from '@/stores/wallet';
import { api, JobFailedError, type JobStatus } from '@/lib/api/client';

const routerReplace = vi.fn();
const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: routerPush }),
  // The page guards with `!FEATURES.MULTI_ASSET) notFound()`; the features
  // mock below forces the flag ON so this is never invoked, but it must
  // exist on the module for the import to resolve.
  notFound: vi.fn(),
}));

// MULTI_ASSET ON (build-time route gate + runtime capability) so the
// create-coin route renders instead of 404-ing / redirecting home.
const FEATURES_STATE = vi.hoisted(() => ({
  APPS_DIRECTORY: false,
  PASSKEY: false,
  DEV_ROUTES: false,
  AUTO_LOCK: false,
  ADDRESS_ROTATION: false,
  TOR_ROUTING: false,
  USERNAME_CLAIM: false,
  MULTI_ASSET: true,
}));
vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
  useFeatures: () => FEATURES_STATE,
}));

const ALICE = { address: 'a'.repeat(64), numPubkeys: 0, xpriv: 'xprv-alice' };

let createSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  routerReplace.mockClear();
  routerPush.mockClear();
  useWalletStore.setState({
    account: ALICE,
    balance: null,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: true,
    storedAddress: ALICE.address,
    storedAuthMethod: 'seed',
    error: null,
  });
  createSpy = vi.spyOn(api, 'createCoin');
});

afterEach(() => {
  createSpy.mockRestore();
  vi.useRealTimers();
});

const completed: JobStatus = {
  job_id: 'mint-1',
  status: 'completed',
  phase: 'completed',
  result: { success: true, proof_id: 1 },
};

describe('CreateCoinPage — validation', () => {
  it('rejects an empty name', async () => {
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-amount-input'), '1000');
    // name empty → submit stays disabled, but force-validate by typing then clearing
    await user.type(screen.getByTestId('create-name-input'), 'x');
    await user.clear(screen.getByTestId('create-name-input'));
    // submit disabled when name empty; assert disabled state
    expect(screen.getByTestId('create-submit-btn')).toBeDisabled();
  });

  it('rejects an amount of 0', async () => {
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '0');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects decimals above the max', async () => {
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.clear(screen.getByTestId('create-decimals-input'));
    await user.type(screen.getByTestId('create-decimals-input'), '99');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe('CreateCoinPage — happy path', () => {
  it('runs the two-phase mint and shows the success screen', async () => {
    createSpy.mockResolvedValue(completed);
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.clear(screen.getByTestId('create-decimals-input'));
    await user.type(screen.getByTestId('create-decimals-input'), '2');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-success-heading')).toBeInTheDocument();
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        account_address: ALICE.address,
        name: 'MyCoin',
        decimals: 2,
        amount: 1000,
        xpriv: ALICE.xpriv,
      }),
      expect.any(Object),
    );

    await user.click(screen.getByTestId('create-done-btn'));
    expect(routerPush).toHaveBeenCalledWith('/');
  });

  it('forwards job phase updates from createCoin to the phase indicator', async () => {
    // The default happy-path mock never invokes `onPhase`; drive it here so
    // the `onPhase: (job) => setPhase(job.phase)` callback runs.
    createSpy.mockImplementation((async (
      _req: unknown,
      opts: { onPhase?: (s: JobStatus) => void },
    ) => {
      opts.onPhase?.({ job_id: 'mint-1', status: 'proving', phase: 'proving' } as JobStatus);
      return completed;
    }) as unknown as typeof api.createCoin);
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-success-heading')).toBeInTheDocument();
    expect(createSpy).toHaveBeenCalledWith(expect.any(Object), expect.any(Object));
  });
});

describe('CreateCoinPage — error surfacing', () => {
  it('shows the translated message when the mint job fails', async () => {
    createSpy.mockRejectedValue(new JobFailedError('mint-x', 'failed', 'prove failed'));
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toHaveTextContent(
      /Beweisgenerierung fehlgeschlagen/,
    );
  });

  it('surfaces a non-API Error message', async () => {
    createSpy.mockRejectedValue(new Error('boom local'));
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toHaveTextContent(/boom local/);
  });
});

describe('CreateCoinPage — redirect guard', () => {
  it('redirects to / when there is no account', async () => {
    useWalletStore.setState({ account: null });
    vi.useFakeTimers();
    render(<CreateCoinPage />);
    expect(screen.getByTestId('redirecting-placeholder')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(routerReplace).toHaveBeenCalledWith('/');
  });
});
