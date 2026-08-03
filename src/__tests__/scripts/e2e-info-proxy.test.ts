// @vitest-environment node
//
// Drives the real `node:http` proxy. happy-dom's fetch enforces SOP and
// would block the upstream hop — node is the correct environment.
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

describe('normalizeInfo', () => {
  it('drops wallet feature, pins domain, derives capabilities, multi_asset always true', () => {
    const out = normalizeInfo(
      {
        network: 'Mutinynet',
        features: ['wallet', 'explorer', 'lightning_bridge'],
        username_domain: 'local.zkcoins.test',
        bitcoin_network: 'mutinynet',
        future_field: 'kept',
      },
      'dev.zkcoins.app',
    );
    expect(out.features).toEqual(['explorer', 'lightning_bridge']);
    expect(out.capabilities).toEqual({
      address_list: true,
      username_claim: false,
      lnurl: true,
      multi_asset: true,
    });
    expect(out.username_domain).toBe('dev.zkcoins.app');
    expect(out).not.toHaveProperty('bitcoin_network');
    expect(out.network).toBe('Mutinynet');
    expect(out.future_field).toBe('kept');
  });

  it('treats non-array features as empty and skips username_domain when unset', () => {
    const out = normalizeInfo(
      {
        network: 'regtest',
        features: 'wallet' as unknown as string[],
        username_domain: 'keep-upstream.example',
      },
      '',
    );
    expect(out.features).toEqual([]);
    expect(out.username_domain).toBe('keep-upstream.example');
    expect(out.capabilities).toEqual({
      address_list: false,
      username_claim: false,
      lnurl: false,
      multi_asset: true,
    });
  });
});

describe('forwardHeaders', () => {
  it('drops host + accept-encoding and keeps everything else', () => {
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
    expect(msg).not.toMatch(/:\/\//);
    expect(msg).not.toMatch(/zkcoins\.app|host\.docker\.internal|@/);
  });
});

describe('createProxyServer', () => {
  it('normalises GET /v1/info from the upstream surface', async () => {
    const upstream = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          network: 'Mutinynet',
          features: ['wallet', 'explorer'],
          username_domain: 'local.zkcoins.test',
          bitcoin_network: 'mutinynet',
        }),
      );
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app' }),
    );

    const res = await fetch(`${proxyUrl}/v1/info`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.json();
    expect(body.features).not.toContain('wallet');
    expect(body.capabilities.username_claim).toBe(false);
    expect(body.capabilities.multi_asset).toBe(true);
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
        seen.body = Buffer.concat(chunks).toString('utf8');
        res.statusCode = 201;
        res.setHeader('x-upstream', 'yes');
        res.end(JSON.stringify({ ok: true }));
      });
    });
    const nodeUrl = await listen(upstream);
    const proxyUrl = await listen(
      createProxyServer({ nodeUrl, usernameDomain: 'dev.zkcoins.app' }),
    );

    const res = await fetch(`${proxyUrl}/v1/tx`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'mint' }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-upstream')).toBe('yes');
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/v1/tx');
    expect(JSON.parse(seen.body)).toEqual({ kind: 'mint' });
  });

  it('returns 502 with a generic body when the upstream is unreachable', async () => {
    const proxyUrl = await listen(
      createProxyServer({
        nodeUrl: 'http://127.0.0.1:1',
        usernameDomain: 'dev.zkcoins.app',
      }),
    );
    const res = await fetch(`${proxyUrl}/v1/info`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'e2e-info-proxy upstream failure' });
  });
});
