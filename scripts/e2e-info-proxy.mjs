/**
 * Test-only `/api/info` capability-normalisation reverse-proxy.
 *
 * ── THIS IS E2E INFRASTRUCTURE, NOT APP CODE ──────────────────────────
 * It is never built into the Next bundle, never shipped in the Docker
 * image, and only ever runs inside `scripts/e2e-local.sh`'s Playwright
 * container. Its sole job is to let the *local* E2E target reuse the
 * exact same `*-chromium-linux.png` baselines the *dev* target produces.
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────
 * The baselines were captured against the hosted DEV stack, whose
 * `GET /api/info` reports every opt-in capability OFF:
 *
 *     dev:   capabilities = { address_list:false, username_claim:false,
 *                             lnurl:false, multi_asset:false }
 *            username_domain = "dev.zkcoins.app"
 *            (no bitcoin_network field)
 *
 * A locally-run node built with `--all-features` reports them ON:
 *
 *     local: capabilities = { address_list:true, username_claim:true,
 *                             lnurl:true, multi_asset:false }
 *            username_domain = "local.zkcoins.test"
 *            bitcoin_network = "mutinynet"
 *
 * `username_claim:true` makes WalletScreen render an extra "Claim a
 * username" form row (+~36px), which shifts ~16 baselines and fails the
 * visual diff. `address_list` / `lnurl` similarly unlock gated UI, and a
 * different `username_domain` changes the rendered address chip (it is
 * masked in screenshots, but the helpers also derive locators from it).
 *
 * So we put this proxy in front of the node and rewrite `GET /api/info`
 * to the single-asset surface. Everything else
 * (jobs/mint/commit/health/...) is passed through 1:1 — the send-success
 * leg drives a real send against the real upstream node.
 *
 * ── SINGLE-ASSET SURFACE TRANSLATION (node #220 era) ──────────────────
 * Since the node's neutral permissionless minting (zk-coins/node #220),
 * the upstream is ALWAYS multi-asset: `GET /api/balance?address=` without
 * an `asset_id` is a hard 422 ("asset_id is required — no native asset"),
 * and `POST /api/jobs/send` without an `asset_id` is rejected the same
 * way. The single-asset app surface (what the baselines were captured
 * against, `multi_asset:false`) performs exactly those two requests, so
 * reporting `multi_asset:false` while passing them through 1:1 would
 * leave the wallet hero permanently loading and every send 422ing. Two
 * narrow translations keep the single-asset surface functional:
 *
 *   1. `GET /api/balance?address=X` (no `asset_id`) → upstream
 *      `GET /api/balance/X` (per-owner portfolio), aggregated into the
 *      legacy `{balance, num_sends, username?}` shape. `num_sends` is the
 *      SUM across assets — the commitment SMT is keyed by pubkey across
 *      ALL assets, so the wallet's BIP-32 send index is wallet-global
 *      (mirrors the app's own multi-asset hydration in
 *      `src/lib/api/client.ts::send`).
 *   2. `POST /api/jobs/send` without `asset_id` → the sender's portfolio
 *      is fetched upstream and, ONLY when the sender holds exactly one
 *      asset, that `asset_id` is injected (the send signature covers
 *      `account_address ‖ recipient ‖ amount ‖ timestamp` — not
 *      `asset_id` — so the injection cannot break it). Zero or multiple
 *      assets forward the body unchanged so the node's own 422 surfaces
 *      loudly instead of a silent wrong-asset send.
 *
 * ── WHY A PROXY AND NOT "build the node with the DEV feature set" ──────
 * Rebuilding the node with a DEV-matching Cargo feature set couples this
 * app repo's E2E run to the node repo's build configuration. The proxy is
 * self-contained: it works against whatever node the operator already has
 * running, including the `--all-features` dev node, without rebuilding it.
 *
 * ── TOPOLOGY (all inside the one Playwright container) ─────────────────
 *     browser ──(same-origin /api/*)──▶ Next standalone
 *                                         └─(rewrites /api/* )─▶ this proxy ─▶ node
 *     e2e helpers (Node) ──(E2E_API_URL)──────────────────────▶ this proxy ─▶ node
 *
 * Both the browser path (via the Next same-origin rewrite) and the
 * test-helper path (`E2E_API_URL`) point at this proxy, so both observe
 * the normalised `/api/info`.
 *
 * ── CONFIG (env) ──────────────────────────────────────────────────────
 *   E2E_INFO_PROXY_PORT   listen port           (default 4243)
 *   E2E_NODE_URL          upstream node base URL (default http://host.docker.internal:4242)
 *   E2E_INFO_USERNAME_DOMAIN  domain to report   (default dev.zkcoins.app)
 *   E2E_INFO_MULTI_ASSET  'true' → report multi_asset:true and pass per-asset
 *                         balance/send through 1:1 (the multi-asset leg,
 *                         specs 18–21); default single-asset surface.
 *
 * No dependencies — Node ≥ 18 built-ins only (http, fetch).
 *
 * The pure helpers and the server factory are exported for the unit
 * suite (`src/__tests__/scripts/e2e-info-proxy.test.ts`); importing this
 * module never binds a port — only the standalone entry at the bottom
 * calls `.listen()`.
 */

import http from 'node:http';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = '4243';
const DEFAULT_NODE_URL = 'http://host.docker.internal:4242';
const DEFAULT_USERNAME_DOMAIN = 'dev.zkcoins.app';

// The DEV capability surface the committed baselines were captured
// against — every opt-in feature OFF. Mirrors `dev-api.zkcoins.app`.
const DEV_CAPABILITIES = {
  address_list: false,
  username_claim: false,
  lnurl: false,
  multi_asset: false,
};

/**
 * Normalise an upstream `/api/info` body to the hosted-DEV surface.
 *
 * `multiAsset` selects which leg's baselines are being driven: the default
 * (false) is the single-asset surface; true reports `multi_asset:true` so the
 * shared Wallet/Send screens render the per-asset surface and the dedicated
 * multi-asset routes (specs 18–21) run instead of skipping. The other opt-in
 * capabilities stay OFF either way so the rest of the surface is identical.
 */
export function normalizeInfo(upstream, usernameDomain, multiAsset = false) {
  // Start from the upstream object so any future field the node adds is
  // preserved by default, then overwrite the baseline-affecting dimensions
  // and drop `bitcoin_network` (DEV omits it).
  const normalized = { ...upstream };
  normalized.capabilities = { ...DEV_CAPABILITIES, multi_asset: multiAsset };
  normalized.username_domain = usernameDomain;
  delete normalized.bitcoin_network;
  return normalized;
}

/**
 * Aggregate an upstream `GET /api/balance/:address` portfolio body into
 * the legacy single-asset `{balance, num_sends, username?}` shape.
 *
 * `balance` is the sum across assets (the single-asset hero shows the
 * wallet's one fixture/faucet asset; an empty portfolio is the canonical
 * `balance: 0`). `num_sends` is ALSO the sum across assets: the wallet
 * uses it as its global BIP-32 send index, and the commitment SMT is
 * keyed by pubkey across all assets — identical to the app's multi-asset
 * send hydration (`src/lib/api/client.ts::send`).
 */
export function aggregateOwnerBalance(portfolio) {
  const assets = Array.isArray(portfolio.assets) ? portfolio.assets : [];
  const out = {
    balance: assets.reduce((sum, a) => sum + a.balance, 0),
    num_sends: assets.reduce((sum, a) => sum + a.num_sends, 0),
  };
  if (portfolio.username) out.username = portfolio.username;
  return out;
}

/**
 * Resolve the `asset_id` to inject into an `asset_id`-less send body.
 *
 * Returns the sole asset's id when the sender's portfolio holds EXACTLY
 * one asset, `null` otherwise (empty or ambiguous portfolio → forward
 * unchanged and let the node's own 422 surface). Never guesses among
 * multiple assets — a silent wrong-asset send under a 200 would be the
 * worst possible failure mode for the suite.
 */
export function soleAssetId(portfolio) {
  const assets = Array.isArray(portfolio.assets) ? portfolio.assets : [];
  if (assets.length !== 1 || typeof assets[0].asset_id !== 'string') return null;
  return assets[0].asset_id;
}

/** Collect a request body as a Buffer (undefined for bodyless methods). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      resolve(undefined);
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    /* c8 ignore next — socket-level read error, not reachable with an
       in-process test client */
    req.on('error', reject);
  });
}

/** Copy upstream headers, dropping hop-by-hop ones the runtime sets itself. */
function copyHeaders(from, to) {
  const drop = new Set([
    'content-length',
    'content-encoding',
    'transfer-encoding',
    'connection',
    'keep-alive',
  ]);
  for (const [k, v] of from.entries()) {
    if (!drop.has(k.toLowerCase())) to.setHeader(k, v);
  }
}

/**
 * Headers to forward upstream, minus the ones that break the hop:
 *
 *   - `host`: Node's fetch rejects a forwarded `host` header.
 *   - `accept-encoding`: when the caller sets this header explicitly,
 *     undici forwards it verbatim and does NOT auto-decompress the
 *     response — `upstream.json()` then chokes on raw gzip/br/zstd
 *     bytes and the pass-through leg would relay a compressed body
 *     after `copyHeaders` dropped `content-encoding`. Browsers always
 *     send `accept-encoding`, so forwarding it 502'd every browser
 *     request while curl (no such header) sailed through. Dropping it
 *     lets undici negotiate + transparently decompress, which is what
 *     both response paths assume.
 */
export function forwardHeaders(headers) {
  const drop = new Set(['host', 'accept-encoding']);
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (drop.has(k.toLowerCase())) continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Client-facing body for an upstream failure.
 *
 * Deliberately carries NO `detail` / error string / stack fragment: the
 * underlying exception can embed server internals (paths, the upstream
 * URL, undici frames), and exposing those to the HTTP caller is a
 * stack-trace-exposure vector (CWE-209, CodeQL `js/stack-trace-exposure`).
 * The cause is logged server-side in the request handler instead, where
 * the operator reads it — the caller only needs to know the hop failed.
 */
export function upstreamFailureBody() {
  return { error: 'e2e-info-proxy upstream failure' };
}

/**
 * Startup diagnostic line.
 *
 * Deliberately free of any process.env-derived string (upstream URL,
 * username domain): an upstream URL can embed credentials
 * (`https://user:secret@host`), and writing environment-sourced values
 * to the log in clear text is CWE-312 (CodeQL `js/clear-text-logging`).
 * The operator already controls the env; the log only needs to confirm
 * the proxy is up and where it listens.
 */
export function startupMessage(port) {
  return `[e2e-info-proxy] listening on :${port} (normalising GET /api/info to the DEV capability surface)`;
}

/**
 * Build the proxy server for a given upstream + reported username domain.
 * Exported as a factory (rather than a module-level singleton) so the
 * unit suite can point it at a mock upstream on an ephemeral port.
 */
export function createProxyServer({ nodeUrl, usernameDomain, multiAsset = false }) {
  const base = nodeUrl.replace(/\/+$/, '');

  return http.createServer(async (req, res) => {
    // Normalise once and use the same value for the route check AND the
    // upstream fetch — the previous code fell back to '/' only for the
    // parse and would have forwarded the literal string "undefined".
    /* c8 ignore next — node's http server always sets req.url; the `?? '/'`
       only satisfies the `string | undefined` type, it is never taken */
    const reqUrl = req.url ?? '/';
    const url = new URL(reqUrl, 'http://localhost');
    const isInfo = req.method === 'GET' && url.pathname === '/api/info';
    // Legacy single-asset balance read — `asset_id`-less form the
    // multi-asset upstream 422s (see the header: SINGLE-ASSET SURFACE
    // TRANSLATION). An `asset_id`-carrying query passes through 1:1.
    const singleAssetBalanceAddress =
      req.method === 'GET' && url.pathname === '/api/balance' && !url.searchParams.has('asset_id')
        ? url.searchParams.get('address')
        : null;
    const isSend = req.method === 'POST' && url.pathname === '/api/jobs/send';

    /** Fetch + parse the upstream per-owner portfolio (throws on non-2xx). */
    const fetchPortfolio = async (address) => {
      const res = await fetch(`${base}/api/balance/${encodeURIComponent(address)}`, {
        redirect: 'manual',
      });
      if (!res.ok) {
        throw new Error(`upstream portfolio lookup failed with ${res.status}`);
      }
      return res.json();
    };

    try {
      // Translation 1 — single-asset balance read. Skipped on the multi-asset
      // leg, where the app issues native per-asset requests itself.
      if (!multiAsset && singleAssetBalanceAddress !== null && singleAssetBalanceAddress !== '') {
        const portfolio = await fetchPortfolio(singleAssetBalanceAddress);
        res.setHeader('content-type', 'application/json');
        res.setHeader('access-control-allow-origin', '*');
        res.statusCode = 200;
        res.end(JSON.stringify(aggregateOwnerBalance(portfolio)));
        return;
      }

      let body = await readBody(req);
      let bodyRewritten = false;

      // Translation 2 — inject the sender's sole asset_id into an
      // asset_id-less send. Non-JSON or shape mismatches forward
      // unchanged (the node answers those itself). Skipped on the
      // multi-asset leg, where the app sends a real `asset_id` itself.
      if (!multiAsset && isSend && body && body.length > 0) {
        let parsed = null;
        try {
          parsed = JSON.parse(body.toString('utf8'));
        } catch {
          /* not JSON — forward verbatim */
        }
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          parsed.asset_id === undefined &&
          typeof parsed.account_address === 'string'
        ) {
          const portfolio = await fetchPortfolio(parsed.account_address);
          const assetId = soleAssetId(portfolio);
          if (assetId !== null) {
            parsed.asset_id = assetId;
            body = Buffer.from(JSON.stringify(parsed), 'utf8');
            bodyRewritten = true;
          }
        }
      }

      const headers = forwardHeaders(req.headers);
      if (bodyRewritten) {
        // The original content-length no longer matches the injected
        // body — drop it and let undici recompute.
        delete headers['content-length'];
      }
      const upstream = await fetch(`${base}${reqUrl}`, {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
      });

      if (isInfo && upstream.ok) {
        const json = await upstream.json();
        const normalized = JSON.stringify(normalizeInfo(json, usernameDomain, multiAsset));
        res.setHeader('content-type', 'application/json');
        // Preserve the node's permissive CORS so the browser path behaves
        // identically whether it hits the node or the proxy.
        res.setHeader('access-control-allow-origin', '*');
        res.statusCode = upstream.status;
        res.end(normalized);
        return;
      }

      // Pass-through for everything else (and for a non-OK /api/info).
      copyHeaders(upstream.headers, res);
      res.statusCode = upstream.status;
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    } catch (err) {
      // Operator-facing detail goes to stderr only; the HTTP caller gets
      // the generic body (see `upstreamFailureBody` for the rationale).
      // eslint-disable-next-line no-console
      console.error('[e2e-info-proxy] upstream failure:', err);
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(upstreamFailureBody()));
    }
  });
}

/* c8 ignore start — standalone entry (`node scripts/e2e-info-proxy.mjs`):
   binds the real port from env config. Exercised by every served-local
   E2E run (ci.yaml + e2e-local.sh); unit tests import the factory and
   never take this path. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number.parseInt(process.env.E2E_INFO_PROXY_PORT ?? DEFAULT_PORT, 10);
  const nodeUrl = process.env.E2E_NODE_URL ?? DEFAULT_NODE_URL;
  const usernameDomain = process.env.E2E_INFO_USERNAME_DOMAIN ?? DEFAULT_USERNAME_DOMAIN;
  const multiAsset = process.env.E2E_INFO_MULTI_ASSET === 'true';
  const server = createProxyServer({ nodeUrl, usernameDomain, multiAsset });
  server.listen(port, '0.0.0.0', () => {
    // Log the port the OS actually bound (server.address()), not the
    // env-derived config value — the diagnostic stays accurate and no
    // process.env-sourced data flows into the log line.
    // eslint-disable-next-line no-console
    console.log(startupMessage(server.address().port));
  });
}
/* c8 ignore stop */
