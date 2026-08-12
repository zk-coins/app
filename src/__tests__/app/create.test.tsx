/**
 * CreateCoinPage (`src/app/create/page.tsx`) — the create-coin flow that
 * replaced the testnet faucet.
 *
 * Covers: the redirect guard (no account), field validation (name,
 * decimals, amount), the happy-path two-phase mint → success screen, and
 * the error-surfacing branch (JobFailedError → translated message).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
import CreateCoinPage from '@/app/create/page';
import { useWalletStore } from '@/stores/wallet';
import { api, JobFailedError, type JobStatus } from '@/lib/api/client';

const routerReplace = vi.fn();
const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: routerPush }),
  // `notFound` stub kept for next/navigation module-surface completeness; the
  // route is default-active now and no longer guards with it.
  notFound: vi.fn(),
}));

// MULTI_ASSET is the runtime node capability; ON here so the create-coin
// route renders instead of redirecting home.
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

const ALICE = {
  address: 'a'.repeat(64),
  mnemonic:
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  nkCommit: '00'.repeat(32),
};

let createSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  routerReplace.mockClear();
  routerPush.mockClear();
  useWalletStore.setState({
    account: ALICE,
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
  kind: 'mint',
  status: 'completed',
  phase: 'completed',
  progress: 1,
  result: { output_coin_ids: ['01'.repeat(32)] },
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

  it('rejects a whitespace-only name even though the raw field is non-empty', async () => {
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), '   ');
    await user.type(screen.getByTestId('create-amount-input'), '1');
    await user.click(screen.getByTestId('create-submit-btn'));
    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
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

  it('normalizes non-digits and leading zeros in numeric inputs', async () => {
    createSpy.mockResolvedValue(completed);
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'Normalized');
    fireEvent.change(screen.getByTestId('create-decimals-input'), { target: { value: 'a2b' } });
    fireEvent.change(screen.getByTestId('create-amount-input'), { target: { value: '000123x' } });
    await user.click(screen.getByTestId('create-submit-btn'));
    await screen.findByTestId('create-success-heading');
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ decimals: 2, amount: '123' }),
      expect.any(Object),
    );
  });

  it('fails closed when signing material is absent', async () => {
    useWalletStore.setState({ account: { ...ALICE, mnemonic: '' } });
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'Unsigned');
    await user.type(screen.getByTestId('create-amount-input'), '1');
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
        amount: '1000',
        mnemonic: ALICE.mnemonic,
        nkCommit: ALICE.nkCommit,
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
      opts.onPhase?.({
        job_id: 'mint-1',
        kind: 'mint',
        status: 'proving',
        phase: 'proving',
        progress: 0.4,
      });
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

  it('accepts a job update without a phase and keeps the phase indicator hidden', async () => {
    let finish!: (job: JobStatus) => void;
    createSpy.mockImplementation((async (_req: unknown, opts: { onPhase?: (s: JobStatus) => void }) => {
      opts.onPhase?.({ ...completed, phase: undefined });
      return new Promise<JobStatus>((resolve) => (finish = resolve));
    }) as unknown as typeof api.createCoin);
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'NoPhase');
    await user.type(screen.getByTestId('create-amount-input'), '1');
    await user.click(screen.getByTestId('create-submit-btn'));
    expect(screen.queryByTestId('create-phase')).toBeNull();
    finish(completed);
    expect(await screen.findByTestId('create-success-heading')).toBeInTheDocument();
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

  it('uses safe translated copy for a non-Error rejection', async () => {
    createSpy.mockRejectedValue('opaque rejection');
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1');
    await user.click(screen.getByTestId('create-submit-btn'));
    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
  });
});

describe('CreateCoinPage — redirect guard', () => {
  it('redirects immediately when the runtime node lacks multi-asset support', () => {
    FEATURES_STATE.MULTI_ASSET = false;
    render(<CreateCoinPage />);
    expect(routerReplace).toHaveBeenCalledWith('/');
    FEATURES_STATE.MULTI_ASSET = true;
  });

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

  it('does not redirect when the store reports an account when the grace callback fires', async () => {
    useWalletStore.setState({ account: null });
    vi.useFakeTimers();
    const { unmount } = render(<CreateCoinPage />);
    const stateWithAccount = { ...useWalletStore.getState(), account: ALICE };
    const getStateSpy = vi.spyOn(useWalletStore, 'getState').mockReturnValue(stateWithAccount);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(routerReplace).not.toHaveBeenCalled();
    getStateSpy.mockRestore();
    unmount();
  });

  it('clears the grace timer on unmount', async () => {
    useWalletStore.setState({ account: null });
    vi.useFakeTimers();
    const { unmount } = render(<CreateCoinPage />);
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(routerReplace).not.toHaveBeenCalled();
  });
});
