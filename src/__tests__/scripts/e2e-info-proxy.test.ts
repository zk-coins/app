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
  createProxyServer,
  forwardHeaders,
  normalizeInfo,
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
});
