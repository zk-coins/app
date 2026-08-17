import { describe, it, expect, vi } from 'vitest';
import { HDKey } from '@scure/bip32';
import {
  accountKeysFromMnemonic,
  createMnemonic,
  deriveNk,
  invoiceKeysFromMnemonic,
  isValidMnemonic,
  operationalBundleHexFromMnemonic,
  seedFromAccountMnemonic,
  spendKeyAt,
} from '@/lib/crypto/account-keys';
import { seedFromMnemonicV1 } from '@zkcoins/sdk';

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

  it('seedFromAccountMnemonic matches seedFromMnemonicV1', () => {
    const a = seedFromAccountMnemonic(FIXTURE);
    const b = seedFromMnemonicV1(FIXTURE);
    expect(a).toEqual(b);
    expect(a.length).toBe(64);
  });

  it('deriveNk rejects non-integer / negative account indexes', () => {
    const seed = seedFromMnemonicV1(FIXTURE);
    expect(() => deriveNk(seed, -1)).toThrow(/account/);
    expect(() => deriveNk(seed, 1.5)).toThrow(/account/);
    expect(() => deriveNk(seed, Number.NaN)).toThrow(/account/);
  });

  it('deriveNk returns 32 bytes for account 0', () => {
    const seed = seedFromMnemonicV1(FIXTURE);
    const nk = deriveNk(seed, 0);
    expect(nk).toBeInstanceOf(Uint8Array);
    expect(nk.length).toBe(32);
  });

  it('operationalBundleHexFromMnemonic is 161 versioned bytes', () => {
    const hex = operationalBundleHexFromMnemonic(FIXTURE);
    expect(hex).toMatch(/^01[0-9a-f]{320}$/);
    expect(operationalBundleHexFromMnemonic(FIXTURE)).toBe(hex);
  });

  it('invoiceKeysFromMnemonic returns 32-byte invoice material', () => {
    const keys = invoiceKeysFromMnemonic(FIXTURE);
    expect(keys.sk0Secret).toBeInstanceOf(Uint8Array);
    expect(keys.sk0Secret.length).toBe(32);
    expect(keys.nkCommit.length).toBe(32);
    expect(keys.ivpk.length).toBe(32);
    expect(keys.opSecret.length).toBe(32);
  });

  it('invoiceKeysFromMnemonic fails closed when the HD child has no private key', () => {
    const orig = HDKey.fromMasterSeed.bind(HDKey);
    const spy = vi.spyOn(HDKey, 'fromMasterSeed').mockImplementation((seed: Uint8Array) => {
      const master = orig(seed);
      const derive = master.derive.bind(master);
      master.derive = ((path: string) => {
        if (path.includes("/1'/0'") || path.endsWith("/2'")) {
          return { privateKey: null } as never;
        }
        return derive(path);
      }) as typeof master.derive;
      return master;
    });
    try {
      expect(() => invoiceKeysFromMnemonic(FIXTURE)).toThrow(/no private key/);
    } finally {
      spy.mockRestore();
    }
  });

  it('deriveNk fails closed when the HD child has no private key', () => {
    const seed = seedFromMnemonicV1(FIXTURE);
    const spy = vi.spyOn(HDKey, 'fromMasterSeed').mockReturnValue({
      derive: () => ({ privateKey: null }),
    } as never);
    try {
      expect(() => deriveNk(seed, 0)).toThrow(/no private key/);
    } finally {
      spy.mockRestore();
    }
  });
});
