/**
 * i18n configuration (next-intl, no URL routing).
 *
 * The app is German-first (matching the project's German UX) with English
 * available. There is no `[locale]` route segment — the wallet is a
 * single-locale SPA per session — so the locale is a fixed default here
 * and the message catalog is loaded once and handed to
 * `NextIntlClientProvider` in `src/app/layout.tsx`.
 *
 * To add a locale switcher later, persist the chosen locale (cookie /
 * store) and read it in `getMessages()` below; the rest of the app reads
 * strings through `useTranslations()` and needs no change.
 */

import de from '../../messages/de.json';
import en from '../../messages/en.json';

export const locales = ['de', 'en'] as const;
export type Locale = (typeof locales)[number];

/** German-first default — matches the project's German UX. */
export const defaultLocale: Locale = 'de';

/**
 * The locale the app actually renders in.
 *
 * Production is always `defaultLocale` (`de`). The ONLY override is a
 * build-time env var consumed exclusively by the Playwright visual harness:
 * the committed `*-chromium-linux.png` baselines (and the specs' text
 * assertions) are rendered against the hosted DEV stack in English, so
 * `scripts/e2e-local.sh` bakes `NEXT_PUBLIC_E2E_LOCALE=en` to reproduce that
 * locale byte-for-byte when generating/verifying baselines locally. An unset
 * or unrecognised value falls back to `defaultLocale`, so a normal `next
 * build` is unaffected.
 */
export const activeLocale: Locale = ((): Locale => {
  const override = process.env.NEXT_PUBLIC_E2E_LOCALE;
  return (locales as readonly string[]).includes(override ?? '')
    ? (override as Locale)
    : defaultLocale;
})();

const catalogs = { de, en } as const;

export type Messages = (typeof catalogs)[Locale];

/** The message catalog for a locale (falls back to the default locale). */
export function getMessages(locale: Locale = defaultLocale): Messages {
  return catalogs[locale] ?? catalogs[defaultLocale];
}
