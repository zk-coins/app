/**
 * Test helper: render a component tree wrapped in `NextIntlClientProvider`
 * with the real default-locale (`de`) catalog, so components that call
 * `useTranslations()` resolve against the same strings the app ships.
 *
 * Re-exports everything from `@testing-library/react` and overrides
 * `render` with the provider-wrapped variant, so tests can
 * `import { render, screen } from '@/__tests__/_helpers/intl'`.
 */

import type { ReactElement, ReactNode } from 'react';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { defaultLocale, getMessages } from '@/i18n/config';

function IntlWrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={defaultLocale} messages={getMessages(defaultLocale)}>
      {children}
    </NextIntlClientProvider>
  );
}

export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return rtlRender(ui, { wrapper: IntlWrapper, ...options });
}

export * from '@testing-library/react';
