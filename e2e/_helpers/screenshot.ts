/**
 * `snap` is the only function specs use to take a screenshot. It applies the
 * default mask set (see e2e/README.md § 7) so individual specs only have to
 * add masks for things specific to that step.
 *
 * Playwright's `mask` option is forgiving with locators that match nothing —
 * data-testid attributes that don't yet exist in the UI are inert. They
 * become effective the moment the matching attribute lands in a component
 * (see e2e/README.md § 7 for the per-PR ownership table).
 */

import { expect, type Locator, type Page } from '@playwright/test';

import { getUsernameDomain, zkAddressRegex } from './api';

export interface SnapOptions {
  mask?: Locator[];
  fullPage?: boolean;
  /** Pixel-level diff tolerance override. Defaults to the project value. */
  maxDiffPixelRatio?: number;
  /** Optional clip rectangle — useful for badge / chip-only shots. */
  clip?: { x: number; y: number; width: number; height: number };
}

async function defaultMasks(page: Page): Promise<Locator[]> {
  // The chip mask's regex is derived from the server-reported
  // `username_domain` so it matches whichever stage the suite is pointed
  // at (`dev.zkcoins.app` on DEV, `zkcoins.app` on PRD). See
  // `api.ts::getUsernameDomain`.
  const domain = await getUsernameDomain();
  return [
    // Wallet-address chip — content match, no attribute needed.
    page.locator(`text=${zkAddressRegex(domain)}`),
    // Single-asset balance hero (multi_asset:false surface) — mask only the
    // volatile USD + BTC value texts, NOT the whole balance card, so the eye
    // toggle and surrounding chrome stay in the diff.
    page.locator('[data-testid="balance-amount-usd"]'),
    page.locator('[data-testid="balance-amount-btc"]'),
    // Per-asset portfolio balance (multi_asset:true surface) — the volatile
    // numeric value lives on each `asset-row-balance` cell. Masking it by
    // default keeps any portfolio-rendering shot stable even if a spec forgets
    // the per-row masks (06/19/21 also mask it explicitly, harmless overlap).
    // The asset name + id are spec-volatile too but are masked per-spec where
    // they're snapshotted, not globally. Both surfaces' masks coexist here;
    // only the rendered surface's elements actually match.
    page.locator('[data-testid="asset-row-balance"]'),
    // Transaction-row amount + timestamp (varies per send).
    page.locator('[data-testid="tx-row-amount"]'),
    page.locator('[data-testid="tx-row-time"]'),
    // The 12 mnemonic words on the SeedFlow reveal screen.
    page.locator('[data-testid="seed-grid"]'),
    // QR code on /receive — encodes the per-run address.
    page.locator('[data-testid="qr-code"]'),
    // The "proof #N" line on /send success.
    page.locator('[data-testid="proof-id"]'),
  ];
}

// Pin variable-content elements to a stable rendered width before snapshot.
// Playwright's mask box is exactly the element's rendered width; without
// this, a value like "$6.20" vs "$620.00" yields different mask widths and
// the visual diff exceeds the tolerance. The pinned widths are conservative
// upper bounds for realistic test states (faucet outputs, transaction
// amounts, proof ids) and only affect snapshot rendering. The per-asset
// portfolio balance (`asset-row-balance`) needs no width pin: its
// `tabular-nums` cell is right-aligned in a fixed-width row, so the mask box
// is stable across runs.
const STABILIZE_CSS = `
  [data-testid="balance-amount-usd"] { min-width: 280px; }
  [data-testid="balance-amount-btc"] { display: inline-block; min-width: 220px; }
  [data-testid="tx-row-amount"] { display: inline-block; min-width: 96px; text-align: right; }
  [data-testid="proof-id"] { display: inline-block; min-width: 80px; }
  /* Transaction-detail value cells: pin every masked value to a uniform
     width so the mask box is identical regardless of the per-run value
     (id, timestamp, circuit digest, amounts) — see the tx-detail spec. */
  [data-testid^="tx-detail-v-"] { display: inline-block; min-width: 170px; }
`;

async function applyStabilizer(page: Page): Promise<void> {
  await page.evaluate((css) => {
    const id = '__e2e_stabilize__';
    let style = document.getElementById(id) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = id;
      document.head.appendChild(style);
    }
    style.textContent = css;
  }, STABILIZE_CSS);
}

/**
 * Take a screenshot and compare against the baseline.
 *
 * Always:
 *   - waits for `domcontentloaded` (initial render landed)
 *   - waits for web fonts (`document.fonts.ready`)
 *   - applies the default mask set, then any spec-specific masks
 *
 * **Why not `networkidle`**: WalletScreen polls `/v1/balance` every 5 s
 * and we have other periodic fetches too. `waitForLoadState('networkidle')`
 * requires 500 ms of network silence and can deadlock under sustained
 * polling. `domcontentloaded` is enough for visual stability once the
 * caller has already asserted a marker locator is visible.
 */
export async function snap(page: Page, name: string, opts: SnapOptions = {}): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.fonts?.ready);
  await applyStabilizer(page);
  const masks = [...(await defaultMasks(page)), ...(opts.mask ?? [])];
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: opts.fullPage ?? false,
    mask: masks,
    ...(opts.maxDiffPixelRatio !== undefined ? { maxDiffPixelRatio: opts.maxDiffPixelRatio } : {}),
    ...(opts.clip ? { clip: opts.clip } : {}),
  });
}

/** Standard viewport presets used across the suite. */
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
} as const;

export async function setViewport(
  page: Page,
  vp: keyof typeof VIEWPORTS = 'mobile',
): Promise<void> {
  await page.setViewportSize(VIEWPORTS[vp]);
}
