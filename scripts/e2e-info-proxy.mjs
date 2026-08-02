/**
 * Test-only `/v1/info` feature-normalisation reverse-proxy.
 *
 * ── THIS IS E2E INFRASTRUCTURE, NOT APP CODE ──────────────────────────
 * It is never built into the Next bundle, never shipped in the Docker
 * image, and only ever runs inside `scripts/e2e-local.sh`'s Playwright
 * container / CI. Its sole job is to let the *local* E2E target reuse
 * the same capability surface the committed baselines expect.
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────
 * Baselines were captured against a node surface with username claim
 * OFF. A local node with `wallet` in features would unlock name-claim
 * UI (when that UI was shown) and shift baselines. The proxy rewrites
 * `GET /v1/info` features + optional username_domain and passes every
 * other `/v1/*` (and health) path through 1:1.
 *
 * ── TOPOLOGY ──────────────────────────────────────────────────────────
 *     browser ──(same-origin /v1/*)──▶ Next standalone
 *                                         └─(rewrites /v1/*)─▶ this proxy ─▶ node
 *     e2e helpers (Node) ──(E2E_API_URL)──────────────────────▶ this proxy ─▶ node
 *
 * ── CONFIG (env) ──────────────────────────────────────────────────────
 *   E2E_INFO_PROXY_PORT   listen port           (default 4243)
 *   E2E_NODE_URL          upstream node base URL
 *   E2E_INFO_USERNAME_DOMAIN  domain to report   (default dev.zkcoins.app)
 *   E2E_INFO_MULTI_ASSET  kept for flag compatibility; v1 is multi-asset
 *                         by construction, so this only affects optional
 *                         feature tagging in diagnostics.
 *
 * No dependencies — Node ≥ 22 built-ins only (http, fetch).
 */

import http from 'node:http';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = '4243';
const DEFAULT_NODE_URL = 'http://host.docker.internal:4242';
const DEFAULT_USERNAME_DOMAIN = 'dev.zkcoins.app';

/**
 * Normalise an upstream `/v1/info` body to the hosted-DEV surface.
 *
 * Drops the `wallet` feature so username-claim UI stays off. Multi-asset
 * is always on in v1; we do not invent a false multi_asset:false.
 */
export function normalizeInfo(upstream, usernameDomain, _multiAsset = false) {
  const normalized = { ...upstream };
  const features = Array.isArray(upstream.features) ? [...upstream.features] : [];
  normalized.features = features.filter((f) => f !== 'wallet');
  if (usernameDomain) {
    normalized.username_domain = usernameDomain;
  }
  // Legacy capability shape some helpers still read.
  normalized.capabilities = {
    address_list: normalized.features.includes('explorer'),
    username_claim: false,
    lnurl: normalized.features.includes('lightning_bridge'),
    multi_asset: true,
  };
  delete normalized.bitcoin_network;
  return normalized;
}

/** Legacy helpers retained for unit tests that still import them. */
export function aggregateOwnerBalance(portfolio) {
  const assets = Array.isArray(portfolio.assets) ? portfolio.assets : [];
  const out = {
    balance: assets.reduce((sum, a) => sum + a.balance, 0),
    num_sends: assets.reduce((sum, a) => sum + a.num_sends, 0),
  };
  if (portfolio.username) out.username = portfolio.username;
  return out;
}

export function soleAssetId(portfolio) {
  const assets = Array.isArray(portfolio.assets) ? portfolio.assets : [];
  if (assets.length !== 1 || typeof assets[0].asset_id !== 'string') return null;
  return assets[0].asset_id;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      resolve(undefined);
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    /* c8 ignore next */
    req.on('error', reject);
  });
}

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

export function forwardHeaders(headers) {
  const drop = new Set(['host', 'accept-encoding']);
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (drop.has(k.toLowerCase())) continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function upstreamFailureBody() {
  return { error: 'e2e-info-proxy upstream failure' };
}

export function startupMessage(port) {
  return `[e2e-info-proxy] listening on :${port} (normalising GET /v1/info to the DEV capability surface)`;
}

/**
 * Build the proxy server for a given upstream + reported username domain.
 */
export function createProxyServer({ nodeUrl, usernameDomain, multiAsset = false }) {
  const base = nodeUrl.replace(/\/+$/, '');

  return http.createServer(async (req, res) => {
    /* c8 ignore next */
    const reqUrl = req.url ?? '/';
    const url = new URL(reqUrl, 'http://localhost');
    const isInfo = req.method === 'GET' && url.pathname === '/v1/info';

    try {
      const body = await readBody(req);
      const headers = forwardHeaders(req.headers);
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
        res.setHeader('access-control-allow-origin', '*');
        res.statusCode = upstream.status;
        res.end(normalized);
        return;
      }

      copyHeaders(upstream.headers, res);
      res.statusCode = upstream.status;
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[e2e-info-proxy] upstream failure:', err);
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(upstreamFailureBody()));
    }
  });
}

/* c8 ignore start */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number.parseInt(process.env.E2E_INFO_PROXY_PORT ?? DEFAULT_PORT, 10);
  const nodeUrl = process.env.E2E_NODE_URL ?? DEFAULT_NODE_URL;
  const usernameDomain = process.env.E2E_INFO_USERNAME_DOMAIN ?? DEFAULT_USERNAME_DOMAIN;
  const multiAsset = process.env.E2E_INFO_MULTI_ASSET === 'true';
  const server = createProxyServer({ nodeUrl, usernameDomain, multiAsset });
  server.listen(port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(startupMessage(server.address().port));
  });
}
/* c8 ignore stop */
