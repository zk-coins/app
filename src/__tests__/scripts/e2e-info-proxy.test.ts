// @vitest-environment node
//
// Drives the real `node:http` proxy. happy-dom's fetch enforces SOP and
// would block the upstream hop — node is the correct environment.
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

  it('rejects non-array features fail-closed', () => {
    expect(() =>
      normalizeInfo(
        {
          network: 'regtest',
          features: 'wallet' as unknown as string[],
          username_domain: 'keep-upstream.example',
        },
        '',
      ),
    ).toThrow(/features missing/);
  });

  it('keeps upstream username_domain when override domain is empty', () => {
    const out = normalizeInfo(
      {
        network: 'regtest',
        features: ['explorer'],
        username_domain: 'keep-upstream.example',
      },
      '',
    );
    expect(out.username_domain).toBe('keep-upstream.example');
    expect(out.features).toEqual(['explorer']);
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

  it('returns 400 when the incoming request has no url', async () => {
    const server = createProxyServer({
      nodeUrl: 'http://127.0.0.1:1',
      usernameDomain: 'dev.zkcoins.app',
    });
    const { Socket } = await import('node:net');
    const req = new http.IncomingMessage(new Socket());
    // Node initialisiert url als ""; der Guard behandelt leere/fehlende URL fail-closed als 400.
    req.method = 'GET';

    let ended = '';
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 0,
      setHeader(name: string, value: string | number) {
        headers[name.toLowerCase()] = String(value);
      },
      end(chunk?: string | Buffer) {
        if (chunk !== undefined && chunk !== null) {
          ended = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        }
      },
    } as unknown as http.ServerResponse;

    const handler = server.listeners('request')[0] as (
      req: http.IncomingMessage,
      res: http.ServerResponse,
    ) => void | Promise<void>;
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(headers['content-type']).toBe('application/json');
    expect(ended).toContain('missing request url');
    expect(JSON.parse(ended)).toEqual({ error: 'missing request url' });
    server.close();
  });
});
