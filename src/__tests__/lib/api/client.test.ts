/**
 * v1 API adapter — info, idempotency, capabilities mapping, fail-closed paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ApiError,
  JobFailedError,
  api,
  newIdempotencyKey,
  capabilitiesFromV1Features,
} from '@/lib/api/client';
import { useNetworkStore } from '@/stores/network';

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
  useNetworkStore.setState({
    apiUrl: 'https://test-api.zkcoins.app',
    network: 'regtest',
    infoError: null,
    infoLoaded: true,
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(headers),
  });
}

describe('newIdempotencyKey', () => {
  it('produces an RFC-4122 v4 UUID', () => {
    expect(newIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it('is unique across calls', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('capabilitiesFromV1Features', () => {
  it('maps closed v1 feature strings', () => {
    expect(capabilitiesFromV1Features(['wallet', 'explorer'])).toEqual({
      address_list: true,
      username_claim: true,
      lnurl: false,
      multi_asset: true,
    });
  });

  it('is multi-asset even with empty features', () => {
    expect(capabilitiesFromV1Features([]).multi_asset).toBe(true);
  });
});

describe('api.info', () => {
  it('GETs /v1/info (not /v1/info)', async () => {
    mockJsonResponse({
      network: 'regtest',
      protocol_version: 'v1',
      features: ['wallet'],
    });
    const info = await api.info();
    expect(mockFetch.mock.calls[0]![0]).toBe('https://test-api.zkcoins.app/v1/info');
    expect(info.network).toBe('regtest');
    expect(info.capabilities?.username_claim).toBe(true);
  });

  it('maps V1ApiError to ApiError', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve(JSON.stringify({ error: 'internal_error', message: 'boom' })),
      headers: new Headers(),
    });
    await expect(api.info()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('api without resolved network', () => {
  it('refuses send when network is unset (no silent assumption)', async () => {
    useNetworkStore.setState({ network: '' });
    await expect(
      api.send({
        account_address: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        recipient: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        amount: 1,
        asset_id: 'aa'.repeat(32),
        mnemonic:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        nkCommit: '00'.repeat(32),
        delivery: {
          type: 'invoice',
          invoice: {
            amount: '1',
            recipient: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
            asset_id: 'aa'.repeat(32),
            pk0: 'bb'.repeat(32),
            nk_commit: 'cc'.repeat(32),
            ivpk: 'dd'.repeat(32),
            op_pubkey: 'ee'.repeat(32),
            relays: ['wss://r.example'],
            addr_sig: '11'.repeat(64),
            sig: '22'.repeat(64),
          },
        },
        input_coins: ['ff'.repeat(32)],
      }),
    ).rejects.toThrow(/network not resolved/);
  });
});

describe('ApiError / JobFailedError shape', () => {
  it('ApiError carries status and serverError', () => {
    const e = new ApiError(422, 'Insufficient funds', '{}');
    expect(e.status).toBe(422);
    expect(e.serverError).toBe('Insufficient funds');
    expect(e).toBeInstanceOf(Error);
  });

  it('JobFailedError carries jobId', () => {
    const e = new JobFailedError('j1', 'failed', 'prove failed');
    expect(e.jobId).toBe('j1');
    expect(e.serverError).toBe('prove failed');
  });
});

describe('name endpoints refuse closed surface gaps', () => {
  it('resolveUsername is not a legacy route — 501', async () => {
    await expect(api.resolveUsername('alice')).rejects.toMatchObject({ status: 501 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('claimUsername is not a legacy route — 501', async () => {
    await expect(
      api.claimUsername({
        username: 'alice',
        address: 'zk1test',
        mnemonic:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      }),
    ).rejects.toMatchObject({ status: 501 });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('read paths refuse invented empty wallets', () => {
  it('ownerBalances is 501 not an empty assets list', async () => {
    await expect(api.ownerBalances('zk1test')).rejects.toMatchObject({ status: 501 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('walletBalance is 501 not balance:0', async () => {
    await expect(
      api.walletBalance({
        address: 'zk1test',
        mnemonic:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        nkCommit: '00'.repeat(32),
      }),
    ).rejects.toMatchObject({ status: 501 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('send with empty input_coins is 501 (no network hop)', async () => {
    await expect(
      api.send({
        account_address: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        recipient: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        amount: 1,
        asset_id: 'aa'.repeat(32),
        mnemonic:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        nkCommit: '00'.repeat(32),
        delivery: {
          type: 'invoice',
          invoice: {
            amount: '1',
            recipient: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
            asset_id: 'aa'.repeat(32),
            pk0: 'bb'.repeat(32),
            nk_commit: 'cc'.repeat(32),
            ivpk: 'dd'.repeat(32),
            op_pubkey: 'ee'.repeat(32),
            relays: ['wss://r.example'],
            addr_sig: '11'.repeat(64),
            sig: '22'.repeat(64),
          },
        },
        input_coins: [],
      }),
    ).rejects.toMatchObject({ status: 501 });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
