/**
 * Component test — `UnlockScreen` (issue #68 W1).
 *
 * Mirrors the assertions in e2e/04-unlock-password.spec.ts at the unit
 * level. `UnlockScreen` lives in `src/components/onboarding/UnlockScreen.tsx`
 * and accepts its unlock handlers as props, so the test never has to
 * stand up the wallet-store wiring `Home` does.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnlockScreen } from '@/components/onboarding/UnlockScreen';

function renderUnlock(
  overrides: Partial<{
    onUnlockPassword: (pw: string) => Promise<void>;
    onUnlockPrf: (prf: Uint8Array) => Promise<void>;
  }> = {},
) {
  const onUnlockPassword = overrides.onUnlockPassword ?? vi.fn().mockResolvedValue(undefined);
  const onUnlockPrf = overrides.onUnlockPrf ?? vi.fn().mockResolvedValue(undefined);
  render(
    <UnlockScreen
      authMethod="seed"
      onUnlockPassword={onUnlockPassword}
      onUnlockPrf={onUnlockPrf}
    />,
  );
  return { onUnlockPassword, onUnlockPrf };
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
