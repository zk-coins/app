/**
 * next-intl request config (App Router, no URL routing).
 *
 * The wallet is single-locale per session — there is no `[locale]` route
 * segment — so this resolves the `activeLocale` (the fixed default `de`,
 * overridable to `en` only by the Playwright visual harness) and hands the
 * matching catalog to next-intl's server runtime. `createNextIntlPlugin`
 * (wired in `next.config.js`) points here. Server Components and the
 * Server-rendered `not-found` page read messages through this; the client
 * tree additionally gets them via `NextIntlClientProvider` in the root
 * layout.
 */

import { getRequestConfig } from 'next-intl/server';
import { activeLocale, getMessages } from './config';

export default getRequestConfig(async () => ({
  locale: activeLocale,
  messages: getMessages(activeLocale),
}));
