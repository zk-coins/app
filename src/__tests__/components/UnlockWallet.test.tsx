/**
 * Component test — `UnlockScreen` (issue #68 W1).
 *
 * Mirrors the assertions in e2e/04-unlock-password.spec.ts at the unit
 * level. `UnlockScreen` lives in `src/components/onboarding/UnlockScreen.tsx`
 * and accepts its unlock handlers as props, so the test never has to
 * stand up the wallet-store wiring `Home` does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  UnlockScreen,
  UNLOCK_RESET_CONFIRM,
  UNLOCK_RESET_ERROR,
} from '@/components/onboarding/UnlockScreen';

// Toggle the PASSKEY feature flag from individual tests. The
// component imports `FEATURES.PASSKEY` synchronously at render
// time, so we replace the module export rather than mutate a
// frozen object.
const FEATURES_STATE = vi.hoisted(() => ({ PASSKEY: false }));
vi.mock('@/lib/features', () => ({
  FEATURES: FEATURES_STATE,
}));

// jsdom does not implement `window.confirm` (calling it throws "Not
// implemented"), so each test that touches the reset flow installs a
// default no-op stub here that the per-test `vi.spyOn` can then attach
// to. `vi.restoreAllMocks()` in afterEach removes the spy; we re-install
// the stub before the next test instead of leaking a real implementation
// across tests.
beforeEach(() => {
  window.confirm = () => false;
});

afterEach(() => {
  FEATURES_STATE.PASSKEY = false;
  vi.restoreAllMocks();
});

function renderUnlock(
  overrides: Partial<{
    authMethod: 'passkey' | 'seed' | null;
    onUnlockPassword: (pw: string) => Promise<void>;
    onUnlockPrf: (prf: Uint8Array) => Promise<void>;
    onReset: () => Promise<void>;
  }> = {},
) {
  const onUnlockPassword = overrides.onUnlockPassword ?? vi.fn().mockResolvedValue(undefined);
  const onUnlockPrf = overrides.onUnlockPrf ?? vi.fn().mockResolvedValue(undefined);
  const onReset = overrides.onReset ?? vi.fn().mockResolvedValue(undefined);
  render(
    <UnlockScreen
      authMethod={overrides.authMethod ?? 'seed'}
      onUnlockPassword={onUnlockPassword}
      onUnlockPrf={onUnlockPrf}
      onReset={onReset}
    />,
  );
  return { onUnlockPassword, onUnlockPrf, onReset };
}

describe('UnlockScreen — password flow', () => {
  it('renders heading and disabled unlock button on mount', () => {
    renderUnlock();
    expect(screen.getByTestId('unlock-heading')).toBeInTheDocument();
    expect(screen.getByTestId('unlock-submit-btn')).toBeDisabled();
  });

  it('enables unlock button once a password is typed', async () => {
    const user = userEvent.setup();
    renderUnlock();
    const input = screen.getByTestId('unlock-password-input');
    const submit = screen.getByTestId('unlock-submit-btn');
    expect(submit).toBeDisabled();
    await user.type(input, 'hunter2hunter2');
    expect(submit).toBeEnabled();
  });

  it('shows "Incorrect password" when onUnlockPassword rejects', async () => {
    const user = userEvent.setup();
    const onUnlockPassword = vi.fn().mockRejectedValue(new Error('bad password'));
    renderUnlock({ onUnlockPassword });

    await user.type(screen.getByTestId('unlock-password-input'), 'wrongpass');
    await user.click(screen.getByTestId('unlock-submit-btn'));

    expect(await screen.findByTestId('unlock-error')).toHaveTextContent('Incorrect password');
    expect(onUnlockPassword).toHaveBeenCalledWith('wrongpass');
  });

  it('Enter key in the password field triggers the unlock handler', async () => {
    const user = userEvent.setup();
    const onUnlockPassword = vi.fn().mockResolvedValue(undefined);
    renderUnlock({ onUnlockPassword });

    const input = screen.getByTestId('unlock-password-input');
    await user.type(input, 'goodpassword{enter}');
    expect(onUnlockPassword).toHaveBeenCalledWith('goodpassword');
  });
});

describe('UnlockScreen — reset escape hatch', () => {
  it('renders the reset link in the password branch', () => {
    renderUnlock();
    const btn = screen.getByTestId('unlock-reset-btn');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent(/forgot password\? reset wallet/i);
  });

  it('renders the reset link in the passkey branch', () => {
    FEATURES_STATE.PASSKEY = true;
    renderUnlock({ authMethod: 'passkey' });
    // Sanity-check we're actually on the passkey branch.
    expect(screen.getByTestId('unlock-passkey-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('unlock-password-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('unlock-reset-btn')).toBeInTheDocument();
  });

  it('prompts the user with the documented confirm copy before resetting', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onReset = vi.fn().mockResolvedValue(undefined);
    renderUnlock({ onReset });

    await user.click(screen.getByTestId('unlock-reset-btn'));

    expect(confirmSpy).toHaveBeenCalledWith(UNLOCK_RESET_CONFIRM);
    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
  });

  it('does NOT call onReset when the user dismisses the confirm', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onReset = vi.fn().mockResolvedValue(undefined);
    renderUnlock({ onReset });

    await user.click(screen.getByTestId('unlock-reset-btn'));

    expect(confirmSpy).toHaveBeenCalledWith(UNLOCK_RESET_CONFIRM);
    expect(onReset).not.toHaveBeenCalled();
  });

  it('shows a transient "Resetting…" label while onReset is in flight', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let resolveReset: (() => void) | undefined;
    const onReset = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        }),
    );
    renderUnlock({ onReset });

    await user.click(screen.getByTestId('unlock-reset-btn'));

    await waitFor(() => {
      const btn = screen.getByTestId('unlock-reset-btn');
      expect(btn).toHaveTextContent(/resetting…/i);
      // `aria-busy` is the semantic signal that goes with the text
      // change — assert both so a future refactor can't silently drop
      // the screen-reader hint.
      expect(btn).toHaveAttribute('aria-busy', 'true');
    });
    resolveReset?.();
    await waitFor(() => {
      const btn = screen.getByTestId('unlock-reset-btn');
      expect(btn).toHaveTextContent(/forgot password/i);
      expect(btn).toHaveAttribute('aria-busy', 'false');
    });
  });

  it('surfaces a user-readable error and clears resetting state when onReset throws', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // Suppress the unhandled-rejection log Vitest prints for the
    // intentionally-rejecting onReset — the component handles it.
    const onReset = vi.fn().mockRejectedValue(new Error('IDB fail'));
    renderUnlock({ onReset });

    await user.click(screen.getByTestId('unlock-reset-btn'));

    expect(await screen.findByTestId('unlock-error')).toHaveTextContent(UNLOCK_RESET_ERROR);
    // Button is back to the idle label so the user can retry — and
    // aria-busy is cleared.
    const btn = screen.getByTestId('unlock-reset-btn');
    expect(btn).toHaveTextContent(/forgot password\? reset wallet/i);
    expect(btn).toHaveAttribute('aria-busy', 'false');
    expect(btn).toBeEnabled();
  });

  it('clears a stale error banner when the user cancels the confirm', async () => {
    // Type a wrong password first so the "Incorrect password" banner
    // is on screen, then click reset and dismiss the confirm. The
    // banner should disappear — leaving it would mislead the user
    // about which action just happened.
    const user = userEvent.setup();
    const onUnlockPassword = vi.fn().mockRejectedValue(new Error('bad password'));
    renderUnlock({ onUnlockPassword });

    await user.type(screen.getByTestId('unlock-password-input'), 'wrongpass');
    await user.click(screen.getByTestId('unlock-submit-btn'));
    expect(await screen.findByTestId('unlock-error')).toHaveTextContent('Incorrect password');

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByTestId('unlock-reset-btn'));

    await waitFor(() => expect(screen.queryByTestId('unlock-error')).not.toBeInTheDocument());
  });
});
