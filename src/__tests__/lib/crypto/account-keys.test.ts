import { describe, it, expect } from 'vitest';
import {
  accountKeysFromMnemonic,
  createMnemonic,
  isValidMnemonic,
  spendKeyAt,
} from '@/lib/crypto/account-keys';

const FIXTURE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('account-keys (SDK pure-TS)', () => {
  it('creates a valid mnemonic', async () => {
    const m = await createMnemonic();
    expect(m.split(' ')).toHaveLength(12);
    expect(await isValidMnemonic(m)).toBe(true);
  });

  it('derives a Bech32m address and nk_commit from the fixture mnemonic', () => {
    const keys = accountKeysFromMnemonic(FIXTURE);
    expect(keys.address.startsWith('zk1')).toBe(true);
    expect(keys.nkCommit).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.pk0).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.numPubkeys).toBe(0);
    expect(keys.mnemonic).toBe(FIXTURE);
  });

  it('derives stable spend keys at index 0 and 1', () => {
    const sk0 = spendKeyAt(FIXTURE, 0);
    const sk1 = spendKeyAt(FIXTURE, 1);
    expect(sk0.publicKey.length).toBe(32);
    expect(sk1.publicKey.length).toBe(32);
    expect(
      Array.from(sk0.publicKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    ).not.toBe(
      Array.from(sk1.publicKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    );
  });

  it('rejects invalid mnemonics', async () => {
    expect(await isValidMnemonic('not a real mnemonic phrase at all here')).toBe(false);
  });
});
