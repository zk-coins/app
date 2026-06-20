// @vitest-environment node
//
// This suite drives a real `node:http` server and uses Node's undici
// `fetch`. The default happy-dom environment overrides `fetch` with a
// browser implementation that enforces the Same-Origin Policy, which
// blocks both the proxy's upstream hop and the test's request to the
// proxy. The proxy is server-side infrastructure, so the node
// environment is the correct fit. (No React is rendered here, so the
// shared `cleanup()` in setup.ts is a no-op.)
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  aggregateOwnerBalance,
  createProxyServer,
  forwardHeaders,
  normalizeInfo,
  soleAssetId,
  startupMessage,
  upstreamFailureBody,
} from '../../../scripts/e2e-info-proxy.mjs';

// ── helpers ───────────────────────────────────────────────────────────
const closers: Array<() => Promise<void>> = [];

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      closers.push(() => new Promise((r) => server.close(() => r())));
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(async () => {
  while (closers.length) await closers.pop()!();
  vi.restoreAllMocks();
});

// ── pure helpers ──────────────────────────────────────────────────────
describe('normalizeInfo', () => {
  it('forces the DEV capability surface, pins the domain, drops bitcoin_network, keeps extras', () => {
    const out = normalizeInfo(
      {
        network: 'Mutinynet',
        capabilities: { address_list: true, username_claim: true, lnurl: true, multi_asset: false },
        username_domain: 'local.zkcoins.test',
        bitcoin_network: 'mutinynet',
        future_field: 'kept',
      },
      'dev.zkcoins.app',
    );
    expect(out.capabilities).toEqual({
      address_list: false,
      username_claim: false,
      lnurl: false,
      multi_asset: false,
    });
    expect(out.username_domain).toBe('dev.zkcoins.app');
    expect(out).not.toHaveProperty('bitcoin_network');
    expect(out.network).toBe('Mutinynet');
    expect(out.future_field).toBe('kept');
  });

  it('reports multi_asset:true on the multi-asset leg, every other capability still off', () => {
    const out = normalizeInfo(
      {
        capabilities: { address_list: true, username_claim: true, lnurl: true, multi_asset: true },
        username_domain: 'local.zkcoins.test',
      },
      'dev.zkcoins.app',
      true,
    );
    expect(out.capabilities).toEqual({
      address_list: false,
      username_claim: false,
      lnurl: false,
      multi_asset: true,
    });
    expect(out.username_domain).toBe('dev.zkcoins.app');
  });
});

describe('forwardHeaders', () => {
  it('drops host + accept-encoding (case-insensitive) and keeps everything else', () => {
    expect(
      forwardHeaders({ Host: 'x', 'Accept-Encoding': 'gzip, br', 'x-idempotency-key': 'abc' }),
    ).toEqual({ 'x-idempotency-key': 'abc' });
  });

  it('skips undefined header values', () => {
    expect(forwardHeaders({ a: undefined, b: '1' })).toEqual({ b: '1' });
  });
});

describe('aggregateOwnerBalance', () => {
  it('sums balance + num_sends across assets and keeps the username', () => {
    expect(
      aggregateOwnerBalance({
        address: 'aa'.repeat(32),
        username: 'alice',
        assets: [
          { asset_id: 'cc'.repeat(32), balance: 100, num_sends: 1 },
          { asset_id: 'dd'.repeat(32), balance: 50, num_sends: 2 },
        ],
      }),
    ).toEqual({ balance: 150, num_sends: 3, username: 'alice' });
  });

  it('returns the canonical zero shape for an empty or malformed portfolio', () => {
    expect(aggregateOwnerBalance({ address: 'aa'.repeat(32), assets: [] })).toEqual({
      balance: 0,
      num_sends: 0,
    });
    // No `assets` array at all → same canonical zero, no username key.
    expect(aggregateOwnerBalance({})).toEqual({ balance: 0, num_sends: 0 });
  });
});

describe('soleAssetId', () => {
  it('returns the asset_id when the portfolio holds exactly one asset', () => {
    expect(soleAssetId({ assets: [{ asset_id: 'cc'.repeat(32), balance: 1, num_sends: 0 }] })).toBe(
      'cc'.repeat(32),
    );
  });

  it('returns null for empty, ambiguous, or malformed portfolios', () => {
    expect(soleAssetId({ assets: [] })).toBeNull();
    expect(
      soleAssetId({
        assets: [
          { asset_id: 'cc'.repeat(32), balance: 1, num_sends: 0 },
          { asset_id: 'dd'.repeat(32), balance: 2, num_sends: 0 },
        ],
      }),
    ).toBeNull();
    expect(soleAssetId({ assets: [{ balance: 1, num_sends: 0 }] })).toBeNull();
    expect(soleAssetId({})).toBeNull();
  });
});

describe('upstreamFailureBody (stack-trace-exposure guard)', () => {
  it('returns only a generic error and never leaks detail/stack to the caller', () => {
    const body = upstreamFailureBody();
    expect(body).toEqual({ error: 'e2e-info-proxy upstream failure' });
    expect(Object.keys(body)).toEqual(['error']);
    expect(JSON.stringify(body)).not.toMatch(/detail|stack|Error:|\bat /);
  });
});

describe('startupMessage (clear-text-logging guard)', () => {
  it('reports the port but never an env-derived URL or username domain', () => {
    const msg = startupMessage(4243);
    expect(msg).toContain('4243');
    expect(msg).not.toMatch(/:\/\//); // no URL
    expect(msg).not.toMatch(/zkcoins\.app|host\.docker\.internal|@/); // no domain / credentials
  });
});

// ── server integration ────────────────────────────────────────────────
describe('createProxyServer', () => {
  it('normalises GET /api/info from the upstream surface', async () => {
    const upstream = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          network: 'Mutinynet',
          capabilities: {
            address_list: true,
            username_claim: true,
            lnurl: true,
            multi_asset: false,
          },
          username_domain: 'local.zkcoins.test',
          bitcoin_network: 'mutinynet',
        }),
      );
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app' }),
    );

    const res = await fetch(`${proxyUrl}/api/info`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.json();
    expect(body.capabilities.username_claim).toBe(false);
    expect(body.username_domain).toBe('dev.zkcoins.app');
    expect(body).not.toHaveProperty('bitcoin_network');
  });

  it('passes non-info requests through 1:1, including request bodies', async () => {
    const seen: { method?: string; url?: string; body: string } = { body: '' };
    const upstream = http.createServer((req, res) => {
      seen.method = req.method;
      seen.url = req.url;
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        seen.body = Buffer.concat(chunks).toString();
        res.statusCode = 207;
        res.setHeader('content-type', 'application/json');
        res.setHeader('x-upstream-marker', 'copied'); // must survive copyHeaders
        res.end(JSON.stringify({ ok: true }));
      });
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app' }),
    );

    const res = await fetch(`${proxyUrl}/api/jobs/send`, {
      method: 'POST',
      body: JSON.stringify({ amount: 1 }),
    });
    expect(res.status).toBe(207);
    expect(res.headers.get('x-upstream-marker')).toBe('copied'); // copyHeaders kept it
    expect(await res.json()).toEqual({ ok: true });
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/api/jobs/send');
    expect(seen.body).toBe(JSON.stringify({ amount: 1 }));
  });

  it('passes a non-OK /api/info through instead of normalising it', async () => {
    const upstream = http.createServer((_req, res) => {
      res.statusCode = 503;
      res.end('upstream down');
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app' }),
    );

    const res = await fetch(`${proxyUrl}/api/info`);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('upstream down');
  });

  it('translates the asset_id-less single-asset balance read into a portfolio aggregate', async () => {
    const seen: string[] = [];
    const upstream = http.createServer((req, res) => {
      seen.push(req.url ?? '');
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          address: 'aa'.repeat(32),
          username: 'alice',
          assets: [
            { asset_id: 'cc'.repeat(32), name: 'E2E-FIXTURE', balance: 100_000, num_sends: 1 },
          ],
        }),
      );
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app' }),
    );

    const res = await fetch(`${proxyUrl}/api/balance?address=${'aa'.repeat(32)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ balance: 100_000, num_sends: 1, username: 'alice' });
    // The proxy queried the per-owner portfolio, not the 422ing flat form.
    expect(seen).toEqual([`/api/balance/${'aa'.repeat(32)}`]);
  });

  it('passes an asset_id-carrying balance read through 1:1', async () => {
    const seen: string[] = [];
    const upstream = http.createServer((req, res) => {
      seen.push(req.url ?? '');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ balance: 7, num_sends: 0 }));
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app' }),
    );

    const query = `address=${'aa'.repeat(32)}&asset_id=${'cc'.repeat(32)}`;
    const res = await fetch(`${proxyUrl}/api/balance?${query}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ balance: 7, num_sends: 0 });
    expect(seen).toEqual([`/api/balance?${query}`]);
  });

  it('passes a balance read with an empty address through (node answers the 422 itself)', async () => {
    const seen: string[] = [];
    const upstream = http.createServer((req, res) => {
      seen.push(req.url ?? '');
      res.statusCode = 422;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ balance: 0, num_sends: 0 }));
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app' }),
    );

    const res = await fetch(`${proxyUrl}/api/balance?address=`);
    expect(res.status).toBe(422);
    expect(seen).toEqual(['/api/balance?address=']);
  });

  it('answers 502 (generic) when the portfolio lookup behind the translation fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const upstream = http.createServer((_req, res) => {
      res.statusCode = 500;
      res.end('boom');
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app' }),
    );

    const res = await fetch(`${proxyUrl}/api/balance?address=${'aa'.repeat(32)}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'e2e-info-proxy upstream failure' });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('injects the sole asset_id into an asset_id-less send body', async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        seen.push({ url: req.url ?? '', body: Buffer.concat(chunks).toString() });
        res.setHeader('content-type', 'application/json');
        if (req.url?.startsWith('/api/balance/')) {
          res.end(
            JSON.stringify({
              address: 'aa'.repeat(32),
              assets: [{ asset_id: 'cc'.repeat(32), balance: 100_000, num_sends: 1 }],
            }),
          );
          return;
        }
        res.statusCode = 202;
        res.end(JSON.stringify({ job_id: 'send-1', status: 'queued' }));
      });
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app' }),
    );

    const sendBody = {
      account_address: 'aa'.repeat(32),
      recipient: 'bb'.repeat(32),
      amount: 1000,
      signature: 'sig',
      timestamp: 1700000000,
    };
    const res = await fetch(`${proxyUrl}/api/jobs/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sendBody),
    });
    expect(res.status).toBe(202);

    const sendHop = seen.find((s) => s.url === '/api/jobs/send');
    expect(sendHop).toBeDefined();
    // The forwarded body is the original send + the resolved sole asset —
    // the signature does NOT cover asset_id, so the injection is safe.
    expect(JSON.parse(sendHop!.body)).toEqual({ ...sendBody, asset_id: 'cc'.repeat(32) });
    // The portfolio lookup hop happened against the sender's address.
    expect(seen.some((s) => s.url === `/api/balance/${'aa'.repeat(32)}`)).toBe(true);
  });

  it('forwards an asset_id-less send unchanged when the sender holds several assets', async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        seen.push({ url: req.url ?? '', body: Buffer.concat(chunks).toString() });
        res.setHeader('content-type', 'application/json');
        if (req.url?.startsWith('/api/balance/')) {
          res.end(
            JSON.stringify({
              address: 'aa'.repeat(32),
              assets: [
                { asset_id: 'cc'.repeat(32), balance: 1, num_sends: 0 },
                { asset_id: 'dd'.repeat(32), balance: 2, num_sends: 0 },
              ],
            }),
          );
          return;
        }
        res.statusCode = 422;
        res.end(JSON.stringify({ error: 'asset_id is required (no native asset)' }));
      });
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app' }),
    );

    const sendBody = { account_address: 'aa'.repeat(32), recipient: 'bb'.repeat(32), amount: 1 };
    const res = await fetch(`${proxyUrl}/api/jobs/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sendBody),
    });
    // Ambiguous portfolio → no guess; the node's own 422 surfaces loudly.
    expect(res.status).toBe(422);
    const sendHop = seen.find((s) => s.url === '/api/jobs/send');
    expect(JSON.parse(sendHop!.body)).toEqual(sendBody);
  });

  it('forwards a send that already carries asset_id without a portfolio lookup', async () => {
    const seen: string[] = [];
    const upstream = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        seen.push(req.url ?? '');
        res.statusCode = 202;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ job_id: 'send-2', status: 'queued' }));
      });
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app' }),
    );

    const res = await fetch(`${proxyUrl}/api/jobs/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_address: 'aa'.repeat(32), asset_id: 'cc'.repeat(32) }),
    });
    expect(res.status).toBe(202);
    expect(seen).toEqual(['/api/jobs/send']);
  });

  it('forwards non-JSON, non-object-JSON, and empty send bodies verbatim', async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        seen.push({ url: req.url ?? '', body: Buffer.concat(chunks).toString() });
        res.statusCode = 400;
        res.end('bad request');
      });
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app' }),
    );

    // Invalid JSON → catch branch.
    await fetch(`${proxyUrl}/api/jobs/send`, { method: 'POST', body: '{not json' });
    // Valid JSON but an array → Array.isArray guard.
    await fetch(`${proxyUrl}/api/jobs/send`, { method: 'POST', body: '[1]' });
    // Valid JSON but not an object → typeof guard.
    await fetch(`${proxyUrl}/api/jobs/send`, { method: 'POST', body: '42' });
    // Empty body → length guard.
    await fetch(`${proxyUrl}/api/jobs/send`, { method: 'POST' });

    expect(seen.map((s) => s.body)).toEqual(['{not json', '[1]', '42', '']);
    expect(seen.every((s) => s.url === '/api/jobs/send')).toBe(true);
  });

  it('returns 502 with a generic body (no detail) when the upstream is unreachable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reserve a port, then close it so nothing is listening — fetch rejects.
    const dead = http.createServer();
    const deadUrl = await listen(dead);
    await new Promise<void>((r) => dead.close(() => r()));

    const proxyUrl = await listen(
      createProxyServer({ nodeUrl: deadUrl, usernameDomain: 'dev.zkcoins.app' }),
    );
    const res = await fetch(`${proxyUrl}/api/info`);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: 'e2e-info-proxy upstream failure' });
    expect(JSON.stringify(body)).not.toMatch(/detail|stack|ECONNREFUSED|127\.0\.0\.1/);
    // The cause is logged server-side only (never returned to the caller).
    expect(errorSpy).toHaveBeenCalled();
  });

  it('multi-asset leg: reports multi_asset:true and passes per-asset balance/send through 1:1', async () => {
    const seen: string[] = [];
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        seen.push(req.url ?? '');
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/info') {
          res.end(
            JSON.stringify({
              capabilities: {
                address_list: true,
                username_claim: true,
                lnurl: true,
                multi_asset: true,
              },
              username_domain: 'local.zkcoins.test',
              bitcoin_network: 'mutinynet',
            }),
          );
          return;
        }
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
      });
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app', multiAsset: true }),
    );

    // /api/info now reports multi_asset:true (the other caps stay normalised off).
    const info = await (await fetch(`${proxyUrl}/api/info`)).json();
    expect(info.capabilities).toEqual({
      address_list: false,
      username_claim: false,
      lnurl: false,
      multi_asset: true,
    });

    // The asset_id-less balance read is NOT rewritten to /api/balance/<addr>,
    // and an asset_id-less send is NOT given a portfolio lookup + injection —
    // the multi-asset app issues native per-asset requests itself.
    await fetch(`${proxyUrl}/api/balance?address=${'aa'.repeat(32)}`);
    await fetch(`${proxyUrl}/api/jobs/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account_address: 'aa'.repeat(32),
        recipient: 'bb'.repeat(32),
        amount: 1,
      }),
    });

    expect(seen).toContain(`/api/balance?address=${'aa'.repeat(32)}`); // verbatim, not aggregated
    expect(seen).toContain('/api/jobs/send');
    expect(seen).not.toContain(`/api/balance/${'aa'.repeat(32)}`); // no portfolio lookup hop
  });
});
