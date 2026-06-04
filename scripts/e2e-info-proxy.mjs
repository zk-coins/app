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
 * So in local mode we put this proxy in front of the node and rewrite
 * ONLY `GET /api/info` to the DEV surface. Everything else
 * (jobs/mint/send/commit/balance/health/...) is passed through 1:1 — the
 * send-success leg drives a real send against the real local node.
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
 *
 * No dependencies — Node ≥ 18 built-ins only (http, fetch).
 */

import http from 'node:http';

const PORT = Number.parseInt(process.env.E2E_INFO_PROXY_PORT ?? '4243', 10);
const NODE_URL = (process.env.E2E_NODE_URL ?? 'http://host.docker.internal:4242').replace(
  /\/+$/,
  '',
);
const USERNAME_DOMAIN = process.env.E2E_INFO_USERNAME_DOMAIN ?? 'dev.zkcoins.app';

// The DEV capability surface the committed baselines were captured
// against — every opt-in feature OFF. Mirrors `dev-api.zkcoins.app`.
const DEV_CAPABILITIES = {
  address_list: false,
  username_claim: false,
  lnurl: false,
  multi_asset: false,
};

/** Normalise an upstream `/api/info` body to the hosted-DEV surface. */
function normalizeInfo(upstream) {
  // Start from the upstream object so any future field the node adds is
  // preserved by default, then overwrite the three baseline-affecting
  // dimensions and drop `bitcoin_network` (DEV omits it).
  const normalized = { ...upstream };
  normalized.capabilities = DEV_CAPABILITIES;
  normalized.username_domain = USERNAME_DOMAIN;
  delete normalized.bitcoin_network;
  return normalized;
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const isInfo = req.method === 'GET' && url.pathname === '/api/info';

  try {
    const body = await readBody(req);
    const upstream = await fetch(`${NODE_URL}${req.url}`, {
      method: req.method,
      headers: forwardHeaders(req.headers),
      body,
      redirect: 'manual',
    });

    if (isInfo && upstream.ok) {
      const json = await upstream.json();
      const normalized = JSON.stringify(normalizeInfo(json));
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
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'e2e-info-proxy upstream failure', detail: String(err) }));
  }
});

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
function forwardHeaders(headers) {
  const drop = new Set(['host', 'accept-encoding']);
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (drop.has(k.toLowerCase())) continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(
    `[e2e-info-proxy] :${PORT} → ${NODE_URL} (normalising GET /api/info to caps=false, username_domain=${USERNAME_DOMAIN})`,
  );
});
