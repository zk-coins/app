/**
 * Send pipeline tests — empty input_coins are refused at the API boundary
 * before any network hop.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { api, ApiError } from '@/lib/api/client';
import { useNetworkStore } from '@/stores/network';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const baseParams = {
  account_address: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  recipient: 'zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  amount: '1',
  asset_id: 'aa'.repeat(32),
  mnemonic: MNEMONIC,
  nkCommit: '00'.repeat(32),
  accountIndex: 0,
  delivery: {
    type: 'invoice' as const,
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
};

beforeEach(() => {
  useNetworkStore.setState({
    apiUrl: 'https://test-api.zkcoins.app',
    network: 'regtest',
    infoError: null,
    infoLoaded: true,
  });
});

describe('send pipeline — fail closed without input coins', () => {
  it('api.send rejects empty input_coins with 501', async () => {
    await expect(api.send({ ...baseParams, input_coins: [] })).rejects.toBeInstanceOf(ApiError);
    await expect(api.send({ ...baseParams, input_coins: [] })).rejects.toMatchObject({
      status: 501,
    });
  });

  it('api.walletSend rejects empty input_coins with 501', async () => {
    await expect(api.walletSend({ ...baseParams, input_coins: [] })).rejects.toMatchObject({
      status: 501,
    });
  });
});
