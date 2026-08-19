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
import { accountKeysFromMnemonic } from '@/lib/crypto/account-keys';
import { useNetworkStore } from '@/stores/network';
import { ApiError, JobFailedError, api, type JobStatus } from '@/lib/api/client';

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
  loaded: true,
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
let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  routerReplace.mockClear();
  routerPush.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  FEATURES_STATE.MULTI_ASSET = true;
  FEATURES_STATE.loaded = true;
  useNetworkStore.setState({ infoError: null });
  useWalletStore.setState({
    account: ALICE,
    isLoading: false,
    isLocked: false,
    hasStoredWallet: true,
    storedAddress: ALICE.address,
    storedAuthMethod: 'seed',
    error: null,
  });
  infoSpy = vi.spyOn(api, 'info').mockResolvedValue({
    network: 'regtest',
    protocol_version: 'v1',
    features: ['wallet'],
    capabilities: {
      address_list: false,
      username_claim: false,
      lnurl: false,
      multi_asset: true,
    },
  });
  createSpy = vi.spyOn(api, 'createCoin');
});

afterEach(() => {
  createSpy.mockRestore();
  infoSpy.mockRestore();
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

describe('CreateCoinPage — session restore', () => {
  it('restores a persisted unlocked session instead of redirecting home', () => {
    const derived = accountKeysFromMnemonic(ALICE.mnemonic);
    const consistent = {
      address: derived.address,
      mnemonic: ALICE.mnemonic,
      nkCommit: derived.nkCommit,
    };
    useWalletStore.getState().setAccount(consistent);
    useWalletStore.setState({ account: null, isLocked: true });
    render(<CreateCoinPage />);
    expect(useWalletStore.getState().account).toEqual(consistent);
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-heading')).toBeInTheDocument();
  });
});

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

  it('rejects an empty amount', async () => {
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    // amount empty → submit stays disabled; force onSubmit via the form
    fireEvent.submit(screen.getByTestId('create-submit-btn').closest('form')!);
    expect(await screen.findByTestId('create-error')).toHaveTextContent(
      'Bitte gib eine Menge größer als 0 ein.',
    );
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects an amount of 0', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '0');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBeNull();
    expect(screen.getByTestId('create-submit-btn')).not.toBeDisabled();

    unmount();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '0');
    expect(screen.getByTestId('create-submit-btn')).not.toBeDisabled();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBeNull();
  });

  it('rejects decimals above the max', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.clear(screen.getByTestId('create-decimals-input'));
    await user.type(screen.getByTestId('create-decimals-input'), '99');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toHaveTextContent(
      'Nachkommastellen müssen zwischen 0 und 18 liegen.',
    );
    expect(createSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBeNull();
    expect(screen.getByTestId('create-submit-btn')).not.toBeDisabled();

    unmount();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.clear(screen.getByTestId('create-decimals-input'));
    await user.type(screen.getByTestId('create-decimals-input'), '99');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    expect(screen.getByTestId('create-submit-btn')).not.toBeDisabled();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBeNull();
  });

  it('rejects empty decimals', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CreateCoinPage />);

    await user.clear(screen.getByTestId('create-decimals-input'));
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toHaveTextContent(
      'Nachkommastellen müssen zwischen 0 und 18 liegen.',
    );
    expect(createSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBeNull();
    expect(screen.getByTestId('create-submit-btn')).not.toBeDisabled();

    unmount();
    render(<CreateCoinPage />);
    await user.clear(screen.getByTestId('create-decimals-input'));
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    expect(screen.getByTestId('create-submit-btn')).not.toBeDisabled();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBeNull();
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
        accountIndex: 0,
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

  it('hides create-phase when onPhase supplies neither phase nor status', async () => {
    let finish!: (job: JobStatus) => void;
    createSpy.mockImplementation((async (
      _req: unknown,
      opts: { onPhase?: (s: JobStatus) => void },
    ) => {
      opts.onPhase?.({ job_id: 'mint-1', kind: 'mint' } as JobStatus);
      return new Promise<JobStatus>((resolve) => (finish = resolve));
    }) as unknown as typeof api.createCoin);
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'NoStatus');
    await user.type(screen.getByTestId('create-amount-input'), '1');
    await user.click(screen.getByTestId('create-submit-btn'));
    expect(screen.queryByTestId('create-phase')).toBeNull();
    finish(completed);
    expect(await screen.findByTestId('create-success-heading')).toBeInTheDocument();
  });

  it('falls back to job.status when onPhase omits phase', async () => {
    let finish!: (job: JobStatus) => void;
    createSpy.mockImplementation((async (
      _req: unknown,
      opts: { onPhase?: (s: JobStatus) => void },
    ) => {
      opts.onPhase?.({ ...completed, status: 'proving', phase: undefined });
      return new Promise<JobStatus>((resolve) => (finish = resolve));
    }) as unknown as typeof api.createCoin);
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'NoPhase');
    await user.type(screen.getByTestId('create-amount-input'), '1');
    await user.click(screen.getByTestId('create-submit-btn'));
    expect(await screen.findByTestId('create-phase')).toHaveTextContent('proving');
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

  it('keeps submit disabled when signature outcome is unknown', async () => {
    createSpy.mockRejectedValue(
      new JobFailedError(
        'mint-x',
        'unknown',
        'signature submit outcome unknown, do not retry as a new transition',
      ),
    );
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    expect(screen.getByTestId('create-submit-btn')).toBeDisabled();
  });

  it('keeps submit disabled when create job fails with timeout', async () => {
    createSpy.mockRejectedValue(
      new JobFailedError('mint-x', 'timeout', 'job timed out after signature submit'),
    );
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    expect(screen.getByTestId('create-submit-btn')).toBeDisabled();
  });

  it('persists timeout lock across unmount/remount via localStorage', async () => {
    createSpy.mockRejectedValue(
      new JobFailedError('mint-x', 'timeout', 'job timed out after signature submit'),
    );
    const user = userEvent.setup();
    const { unmount } = render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBe('1');

    unmount();
    render(<CreateCoinPage />);

    // Form fields reset on remount; refill so disabled is not due to empty inputs.
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    expect(screen.getByTestId('create-submit-btn')).toBeDisabled();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBe('1');
  });

  it('persists create lock across unmount/remount while createCoin is still pending', async () => {
    createSpy.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    const { unmount } = render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    await expect(createSpy).toHaveBeenCalled();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBe('1');

    unmount();
    render(<CreateCoinPage />);

    // Form fields reset on remount; refill so disabled is not due to empty inputs.
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    expect(screen.getByTestId('create-submit-btn')).toBeDisabled();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBe('1');
  });

  it('writes localStorage lock on unknown and protocol JobFailedError', async () => {
    const user = userEvent.setup();

    createSpy.mockRejectedValue(
      new JobFailedError(
        'mint-x',
        'unknown',
        'signature submit outcome unknown, do not retry as a new transition',
      ),
    );
    const { unmount: unmountUnknown } = render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));
    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBe('1');
    unmountUnknown();
    localStorage.clear();

    createSpy.mockRejectedValue(
      new JobFailedError('mint-x', 'protocol', 'protocol error after signature submit'),
    );
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));
    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBe('1');
  });

  it('removes localStorage lock on definite failed JobFailedError', async () => {
    createSpy.mockRejectedValue(new JobFailedError('mint-x', 'failed', 'prove failed'));
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBeNull();
    expect(screen.getByTestId('create-submit-btn')).not.toBeDisabled();
  });

  it('removes localStorage lock on cancelled JobFailedError', async () => {
    createSpy.mockRejectedValue(new JobFailedError('mint-x', 'cancelled', 'mint cancelled'));
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBeNull();
    expect(screen.getByTestId('create-submit-btn')).not.toBeDisabled();
  });

  it('removes localStorage lock on a proven pre-admit ApiError', async () => {
    createSpy.mockRejectedValue(new ApiError(400, 'bad request'));
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBeNull();
    expect(screen.getByTestId('create-submit-btn')).not.toBeDisabled();
  });

  it('removes localStorage lock on successful create', async () => {
    createSpy.mockResolvedValue(completed);
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-success-heading')).toBeInTheDocument();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBeNull();
  });

  it('surfaces a non-API Error message', async () => {
    createSpy.mockRejectedValue(new Error('boom local'));
    const user = userEvent.setup();
    render(<CreateCoinPage />);

    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(await screen.findByTestId('create-error')).toHaveTextContent(/boom local/);
    expect(screen.getByTestId('create-submit-btn')).toBeDisabled();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBe('1');
  });

  it('uses safe translated copy for a non-Error rejection', async () => {
    createSpy.mockRejectedValue('opaque rejection');
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1');
    await user.click(screen.getByTestId('create-submit-btn'));
    expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    expect(screen.getByTestId('create-submit-btn')).toBeDisabled();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBe('1');
  });
});

describe('CreateCoinPage — lock', () => {
  it('locks when another tab writes the create lock and ignores unrelated storage keys', async () => {
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: '1' }));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: `zkcoins.create.lock.${ALICE.address}`,
          newValue: null,
        }),
      );
    });
    expect(screen.getByTestId('create-submit-btn')).not.toBeDisabled();

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: `zkcoins.create.lock.${ALICE.address}`,
          newValue: '1',
        }),
      );
    });
    expect(screen.getByTestId('create-submit-btn')).toBeDisabled();
  });

  it('unlocks when another tab clears the create lock while this tab is not in-flight', async () => {
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: `zkcoins.create.lock.${ALICE.address}`,
          newValue: '1',
        }),
      );
    });
    expect(screen.getByTestId('create-submit-btn')).toBeDisabled();

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: `zkcoins.create.lock.${ALICE.address}`,
          newValue: null,
        }),
      );
    });
    expect(screen.getByTestId('create-submit-btn')).not.toBeDisabled();
  });

  it('does not unlock when another tab clears the lock while mint is in-flight', async () => {
    let resolveCreate!: (job: JobStatus) => void;
    createSpy.mockImplementation(
      () =>
        new Promise<JobStatus>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const lockKey = `zkcoins.create.lock.${ALICE.address}`;
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));

    expect(createSpy).toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: lockKey,
          newValue: null,
        }),
      );
    });
    expect(screen.getByTestId('create-submit-btn')).toBeDisabled();

    resolveCreate(completed);
  });

  it('does not start create when localStorage already has the create lock', async () => {
    localStorage.setItem(`zkcoins.create.lock.${ALICE.address}`, '1');
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));
    expect(createSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-submit-btn')).toBeDisabled();
    expect(localStorage.getItem(`zkcoins.create.lock.${ALICE.address}`)).toBe('1');
  });

  it('does not mint on pre-seeded lock and re-enables when another tab clears it', async () => {
    const lockKey = `zkcoins.create.lock.${ALICE.address}`;
    localStorage.setItem(lockKey, '1');
    const user = userEvent.setup();
    render(<CreateCoinPage />);
    await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
    await user.type(screen.getByTestId('create-amount-input'), '1000');
    await user.click(screen.getByTestId('create-submit-btn'));
    expect(createSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-submit-btn')).toBeDisabled();

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: lockKey,
          newValue: null,
        }),
      );
    });
    expect(screen.getByTestId('create-submit-btn')).not.toBeDisabled();
  });

  it('starts createCoin only once when submit fires twice in the same tick', async () => {
    const noLockStorage: Storage = {
      get length() {
        return 0;
      },
      clear() {},
      getItem() {
        return null;
      },
      key() {
        return null;
      },
      removeItem() {},
      setItem() {},
    };
    vi.stubGlobal('localStorage', noLockStorage);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: noLockStorage,
    });
    try {
      let resolveCreate!: (job: JobStatus) => void;
      render(<CreateCoinPage />);
      fireEvent.change(screen.getByTestId('create-name-input'), { target: { value: 'MyCoin' } });
      fireEvent.change(screen.getByTestId('create-amount-input'), { target: { value: '1000' } });
      const form = screen.getByTestId('create-submit-btn').closest('form')!;
      createSpy.mockImplementation(() => {
        fireEvent.submit(form);
        return new Promise<JobStatus>((resolve) => {
          resolveCreate = resolve;
        });
      });
      fireEvent.submit(form);
      expect(createSpy).toHaveBeenCalledTimes(1);
      resolveCreate(completed);
      expect(await screen.findByTestId('create-success-heading')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('treats getItem throw as locked and keeps submit disabled', async () => {
    const throwingGet: Storage = {
      get length() {
        return 0;
      },
      clear() {},
      getItem() {
        throw new Error('quota');
      },
      key() {
        return null;
      },
      removeItem() {},
      setItem() {},
    };
    vi.stubGlobal('localStorage', throwingGet);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: throwingGet,
    });
    try {
      const user = userEvent.setup();
      render(<CreateCoinPage />);
      await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
      await user.type(screen.getByTestId('create-amount-input'), '1000');
      expect(screen.getByTestId('create-submit-btn')).toBeDisabled();
      expect(createSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not start create when setItem throws', async () => {
    const throwingSet: Storage = {
      get length() {
        return 0;
      },
      clear() {},
      getItem() {
        return null;
      },
      key() {
        return null;
      },
      removeItem() {},
      setItem() {
        throw new Error('quota');
      },
    };
    vi.stubGlobal('localStorage', throwingSet);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: throwingSet,
    });
    try {
      createSpy.mockResolvedValue(completed);
      const user = userEvent.setup();
      render(<CreateCoinPage />);
      await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
      await user.type(screen.getByTestId('create-amount-input'), '1000');
      await user.click(screen.getByTestId('create-submit-btn'));
      expect(createSpy).not.toHaveBeenCalled();
      expect(screen.queryByTestId('create-success-heading')).not.toBeInTheDocument();
      expect(screen.getByTestId('create-submit-btn')).toBeDisabled();
      expect(await screen.findByTestId('create-error')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps success visible when removeItem throws', async () => {
    const throwingRemove: Storage = {
      get length() {
        return 0;
      },
      clear() {},
      getItem() {
        return null;
      },
      key() {
        return null;
      },
      removeItem() {
        throw new Error('quota');
      },
      setItem() {},
    };
    vi.stubGlobal('localStorage', throwingRemove);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: throwingRemove,
    });
    try {
      createSpy.mockResolvedValue(completed);
      const user = userEvent.setup();
      render(<CreateCoinPage />);
      await user.type(screen.getByTestId('create-name-input'), 'MyCoin');
      await user.type(screen.getByTestId('create-amount-input'), '1000');
      await user.click(screen.getByTestId('create-submit-btn'));
      expect(await screen.findByTestId('create-success-heading')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('CreateCoinPage — redirect guard', () => {
  it('redirects immediately when the runtime node lacks multi-asset support', () => {
    FEATURES_STATE.MULTI_ASSET = false;
    FEATURES_STATE.loaded = true;
    render(<CreateCoinPage />);
    expect(routerReplace).toHaveBeenCalledWith('/');
  });

  it('does not redirect when multi-asset is fail-closed after infoError', () => {
    FEATURES_STATE.MULTI_ASSET = false;
    FEATURES_STATE.loaded = true;
    useNetworkStore.setState({ infoError: 'GET /v1/info failed' });
    render(<CreateCoinPage />);
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('does not redirect when capabilities have not loaded yet', () => {
    FEATURES_STATE.MULTI_ASSET = false;
    FEATURES_STATE.loaded = false;
    render(<CreateCoinPage />);
    expect(routerReplace).not.toHaveBeenCalled();
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
