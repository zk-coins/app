import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/__tests__/_helpers/intl';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { useWalletStore } from '@/stores/wallet';
import { useAuthStore } from '@/stores/auth';

const mocks = vi.hoisted(() => {
  class PrfError extends Error {}
  return {
    PrfError,
    passkeySupported: vi.fn(() => true),
    createPasskey: vi.fn(),
    authenticatePasskey: vi.fn(),
    deriveMnemonic: vi.fn(),
    saveCredential: vi.fn(),
    createMnemonic: vi.fn(),
    isValidMnemonic: vi.fn(),
    accountKeys: vi.fn(),
  };
});

vi.mock('@/lib/features', () => ({
  FEATURES: { PASSKEY: true },
  useFeatures: () => ({ PASSKEY: true }),
}));

vi.mock('@/lib/crypto/passkey', () => ({
  isPasskeySupported: mocks.passkeySupported,
  createPasskey: mocks.createPasskey,
  authenticatePasskey: mocks.authenticatePasskey,
  PasskeyPrfUnsupportedError: mocks.PrfError,
}));

vi.mock('@/lib/crypto/key-derivation', () => ({
  DERIVATION_VERSION: 'v1',
  deriveMnemonicFromPrf: mocks.deriveMnemonic,
}));

vi.mock('@/lib/crypto/storage', () => ({
  saveCredential: mocks.saveCredential,
}));

vi.mock('@/lib/crypto/account-keys', () => ({
  createMnemonic: mocks.createMnemonic,
  isValidMnemonic: mocks.isValidMnemonic,
  accountKeysFromMnemonic: mocks.accountKeys,
}));

const FIXTURE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PRF = new Uint8Array([1, 2, 3]);
const ACCOUNT = { address: 'a'.repeat(64), mnemonic: FIXTURE, nkCommit: '00'.repeat(32) };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openPasskeyCreate() {
  const user = userEvent.setup();
  render(<Onboarding />);
  await user.click(screen.getByTestId('onboarding-create-btn'));
  expect(screen.getByText('Use a passkey')).toBeInTheDocument();
  return user;
}

async function openPasskeyRestore() {
  const user = userEvent.setup();
  render(<Onboarding />);
  await user.click(screen.getByTestId('onboarding-restore-btn'));
  await user.click(screen.getByTestId('passkey-restore-btn'));
  expect(screen.getByText('Restore with passkey')).toBeInTheDocument();
  return user;
}

beforeEach(() => {
  mocks.passkeySupported.mockReturnValue(true);
  mocks.createPasskey.mockResolvedValue({ credentialId: 'cred-create', prfOutput: PRF });
  mocks.authenticatePasskey.mockResolvedValue({ credentialId: 'cred-restore', prfOutput: PRF });
  mocks.deriveMnemonic.mockResolvedValue(FIXTURE);
  mocks.saveCredential.mockResolvedValue(undefined);
  mocks.createMnemonic.mockResolvedValue(FIXTURE);
  mocks.isValidMnemonic.mockResolvedValue(true);
  mocks.accountKeys.mockReturnValue(ACCOUNT);
  useWalletStore.setState({
    account: null,
    saveWithPassword: vi.fn().mockResolvedValue(undefined),
    saveWithPrf: vi.fn().mockResolvedValue(undefined),
  } as never);
  useAuthStore.setState({ setAuth: vi.fn() } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Onboarding passkey creation', () => {
  it('registers, persists, encrypts, and activates a passkey wallet', async () => {
    const user = await openPasskeyCreate();
    await user.click(screen.getByRole('button', { name: 'Register passkey' }));

    await waitFor(() => expect(mocks.saveCredential).toHaveBeenCalled());
    expect(useWalletStore.getState().saveWithPrf).toHaveBeenCalledWith(PRF, ACCOUNT);
    expect(useAuthStore.getState().setAuth).toHaveBeenCalledWith('passkey', 'cred-create');
  });

  it('shows registering and creating intermediate states', async () => {
    const registration = deferred<{ credentialId: string; prfOutput: Uint8Array }>();
    const derivation = deferred<string>();
    mocks.createPasskey.mockReturnValue(registration.promise);
    mocks.deriveMnemonic.mockReturnValue(derivation.promise);
    const user = await openPasskeyCreate();
    await user.click(screen.getByRole('button', { name: 'Register passkey' }));
    expect(screen.getByRole('button', { name: 'Waiting for device…' })).toBeDisabled();

    registration.resolve({ credentialId: 'deferred', prfOutput: PRF });
    expect(await screen.findByRole('button', { name: 'Creating wallet…' })).toBeDisabled();
    derivation.resolve(FIXTURE);
    await waitFor(() => expect(useAuthStore.getState().setAuth).toHaveBeenCalled());
  });

  it('offers seed login and supports back navigation', async () => {
    const user = await openPasskeyCreate();
    await user.click(screen.getByTestId('passkey-other-options-btn'));
    expect(await screen.findByTestId('seed-flow')).toBeInTheDocument();
    await user.click(screen.getByTestId('onboarding-step-back-btn'));
    expect(screen.getByText('Use a passkey')).toBeInTheDocument();
    await user.click(screen.getByTestId('onboarding-step-back-btn'));
    expect(screen.getByTestId('welcome-heading')).toBeInTheDocument();
  });

  it('reports unsupported hardware without invoking registration', async () => {
    mocks.passkeySupported.mockReturnValue(false);
    const user = await openPasskeyCreate();
    await user.click(screen.getByRole('button', { name: 'Register passkey' }));
    expect(screen.getByText(/Passkeys are not supported/)).toBeInTheDocument();
    expect(mocks.createPasskey).not.toHaveBeenCalled();
  });

  it.each([
    [new mocks.PrfError(), /PRF extension needed/],
    [Object.assign(new Error('cancel'), { name: 'NotAllowedError' }), /registration cancelled/],
    [Object.assign(new Error('abort'), { name: 'AbortError' }), /registration cancelled/],
    [new Error('secure enclave failed'), /secure enclave failed/],
    ['opaque failure', /registration failed/],
  ])('surfaces registration failure %# and permits retry', async (failure, message) => {
    mocks.createPasskey.mockRejectedValue(failure);
    const user = await openPasskeyCreate();
    await user.click(screen.getByRole('button', { name: 'Register passkey' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register passkey' })).toBeEnabled();
  });
});

describe('Onboarding passkey restore', () => {
  it('authenticates, persists, encrypts, and activates the restored wallet', async () => {
    const user = await openPasskeyRestore();
    await user.click(screen.getByRole('button', { name: 'Authenticate with passkey' }));
    await waitFor(() => expect(mocks.saveCredential).toHaveBeenCalled());
    expect(useWalletStore.getState().saveWithPrf).toHaveBeenCalledWith(PRF, ACCOUNT);
    expect(useAuthStore.getState().setAuth).toHaveBeenCalledWith('passkey', 'cred-restore');
  });

  it('shows authenticating/restoring states and returns to seed import', async () => {
    const authentication = deferred<{ credentialId: string; prfOutput: Uint8Array }>();
    const derivation = deferred<string>();
    mocks.authenticatePasskey.mockReturnValue(authentication.promise);
    mocks.deriveMnemonic.mockReturnValue(derivation.promise);
    const user = await openPasskeyRestore();
    await user.click(screen.getByRole('button', { name: 'Authenticate with passkey' }));
    expect(screen.getByRole('button', { name: 'Waiting for device…' })).toBeDisabled();
    authentication.resolve({ credentialId: 'deferred', prfOutput: PRF });
    expect(await screen.findByRole('button', { name: 'Restoring wallet…' })).toBeDisabled();
    derivation.resolve(FIXTURE);
    await waitFor(() => expect(useAuthStore.getState().setAuth).toHaveBeenCalled());
  });

  it('navigates back to seed import', async () => {
    const user = await openPasskeyRestore();
    await user.click(screen.getByTestId('onboarding-step-back-btn'));
    expect(screen.getByTestId('seed-import-textarea')).toBeInTheDocument();
  });

  it('reports unsupported hardware without authenticating', async () => {
    mocks.passkeySupported.mockReturnValue(false);
    const user = await openPasskeyRestore();
    await user.click(screen.getByRole('button', { name: 'Authenticate with passkey' }));
    expect(screen.getByText(/Passkeys are not supported/)).toBeInTheDocument();
    expect(mocks.authenticatePasskey).not.toHaveBeenCalled();
  });

  it.each([
    [new mocks.PrfError(), /PRF extension/],
    [Object.assign(new Error('cancel'), { name: 'NotAllowedError' }), /Authentication cancelled/],
    [Object.assign(new Error('abort'), { name: 'AbortError' }), /Authentication cancelled/],
    [new Error('credential missing'), /credential missing/],
    ['opaque failure', /authentication failed/],
  ])('surfaces authentication failure %# and permits retry', async (failure, message) => {
    mocks.authenticatePasskey.mockRejectedValue(failure);
    const user = await openPasskeyRestore();
    await user.click(screen.getByRole('button', { name: 'Authenticate with passkey' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Authenticate with passkey' })).toBeEnabled();
  });
});

describe('Onboarding seed failure paths', () => {
  it.each([
    [new Error('entropy unavailable'), /entropy unavailable/],
    ['opaque', /Failed to generate/],
  ])('surfaces mnemonic generation failure %#', async (failure, message) => {
    mocks.createMnemonic.mockRejectedValue(failure);
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-create-btn'));
    await user.click(screen.getByTestId('passkey-other-options-btn'));
    expect(await screen.findByTestId('seed-error')).toHaveTextContent(message);
  });

  it('does not update an unmounted seed flow after mnemonic generation resolves', async () => {
    const mnemonic = deferred<string>();
    mocks.createMnemonic.mockReturnValue(mnemonic.promise);
    const user = await openPasskeyCreate();
    await user.click(screen.getByTestId('passkey-other-options-btn'));
    await user.click(screen.getByTestId('onboarding-step-back-btn'));
    mnemonic.resolve(FIXTURE);
    await waitFor(() => expect(screen.getByText('Use a passkey')).toBeInTheDocument());
  });

  it('does not report mnemonic generation failure after the seed flow unmounts', async () => {
    const mnemonic = deferred<string>();
    mocks.createMnemonic.mockReturnValue(mnemonic.promise);
    const user = userEvent.setup();
    const { unmount } = render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-create-btn'));
    await user.click(screen.getByTestId('passkey-other-options-btn'));
    expect(mocks.createMnemonic).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      mnemonic.reject(new Error('entropy failed after unmount'));
      await Promise.resolve();
    });
    expect(screen.queryByTestId('seed-error')).not.toBeInTheDocument();
  });

  it.each([
    [new Error('disk full'), /disk full/],
    ['opaque', /Failed to create wallet/],
  ])('surfaces seed persistence failure %#', async (failure, message) => {
    useWalletStore.setState({ saveWithPassword: vi.fn().mockRejectedValue(failure) } as never);
    const user = await openPasskeyCreate();
    await user.click(screen.getByTestId('passkey-other-options-btn'));
    await user.click(await screen.findByTestId('seed-reveal-btn'));
    await user.click(screen.getByTestId('seed-written-btn'));
    await user.click(screen.getByTestId('seed-confirm-btn'));
    await user.type(screen.getByTestId('seed-password-input'), 'password123');
    await user.type(screen.getByTestId('seed-password-confirm-input'), 'password123');
    await user.click(screen.getByTestId('seed-create-btn'));
    expect(await screen.findByTestId('seed-error')).toHaveTextContent(message);
    expect(screen.getByTestId('seed-password-stage')).toBeInTheDocument();
  });

  it.each([
    [new Error('dictionary failed'), /dictionary failed/],
    ['opaque', /Validation failed/],
  ])('surfaces seed validation failure %#', async (failure, message) => {
    mocks.isValidMnemonic.mockRejectedValue(failure);
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-restore-btn'));
    await user.type(screen.getByTestId('seed-import-textarea'), FIXTURE);
    await user.click(screen.getByTestId('seed-import-continue-btn'));
    expect(await screen.findByTestId('seed-import-error')).toHaveTextContent(message);
  });

  it.each([
    [new Error('write failed'), /write failed/],
    ['opaque', /Failed to restore wallet/],
  ])('surfaces seed restore persistence failure %#', async (failure, message) => {
    useWalletStore.setState({ saveWithPassword: vi.fn().mockRejectedValue(failure) } as never);
    const user = userEvent.setup();
    render(<Onboarding />);
    await user.click(screen.getByTestId('onboarding-restore-btn'));
    await user.type(screen.getByTestId('seed-import-textarea'), FIXTURE);
    await user.click(screen.getByTestId('seed-import-continue-btn'));
    await user.type(screen.getByTestId('seed-import-password-input'), 'password123');
    await user.type(screen.getByTestId('seed-import-password-confirm-input'), 'password123');
    await user.click(screen.getByTestId('seed-import-submit-btn'));
    expect(await screen.findByTestId('seed-import-error')).toHaveTextContent(message);
    expect(screen.getByTestId('seed-import-password-stage')).toBeInTheDocument();
  });

  it('allows backing out of seed import and discarding with onDiscardLegacy', async () => {
    const user = userEvent.setup();
    const onDiscardLegacy = vi.fn();
    render(<Onboarding reimportRequired onDiscardLegacy={onDiscardLegacy} />);
    await user.click(screen.getByTestId('onboarding-discard-legacy-btn'));
    expect(onDiscardLegacy).toHaveBeenCalled();
    await user.click(screen.getByTestId('onboarding-restore-btn'));
    await user.click(screen.getByTestId('onboarding-step-back-btn'));
    expect(screen.getByTestId('welcome-heading')).toBeInTheDocument();
  });
});
