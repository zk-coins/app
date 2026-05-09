import { describe, it, expect } from 'vitest';
import { deriveKeyFromPassword, deriveKeyFromPrf, encrypt, decrypt } from '@/lib/crypto/encryption';

describe('encryption', () => {
  describe('deriveKeyFromPassword', () => {
    it('generates a random salt when none provided', async () => {
      const result1 = await deriveKeyFromPassword('testpassword');
      const result2 = await deriveKeyFromPassword('testpassword');
      expect(result1.salt).not.toEqual(result2.salt);
    });

    it('uses the provided salt deterministically', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const result1 = await deriveKeyFromPassword('testpassword', salt);
      const result2 = await deriveKeyFromPassword('testpassword', salt);
      // Keys are CryptoKey objects, so we test via encrypt/decrypt roundtrip
      const plaintext = 'hello world';
      const encrypted = await encrypt(plaintext, result1.key, result1.salt);
      const decrypted = await decrypt(encrypted, result2.key);
      expect(decrypted).toBe(plaintext);
    });

    it('returns a CryptoKey with AES-GCM algorithm', async () => {
      const { key } = await deriveKeyFromPassword('testpassword');
      expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    it('returns a 16-byte salt', async () => {
      const { salt } = await deriveKeyFromPassword('testpassword');
      expect(salt.length).toBe(16);
    });
  });

  describe('deriveKeyFromPrf', () => {
    it('returns a CryptoKey with AES-GCM algorithm', async () => {
      const prfOutput = crypto.getRandomValues(new Uint8Array(32));
      const key = await deriveKeyFromPrf(prfOutput);
      expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    it('produces deterministic keys from same PRF output', async () => {
      const prfOutput = crypto.getRandomValues(new Uint8Array(32));
      const key1 = await deriveKeyFromPrf(prfOutput);
      const key2 = await deriveKeyFromPrf(prfOutput);
      // Verify via roundtrip
      const plaintext = 'deterministic test';
      const encrypted = await encrypt(plaintext, key1);
      const decrypted = await decrypt(encrypted, key2);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different keys from different PRF outputs', async () => {
      const prf1 = crypto.getRandomValues(new Uint8Array(32));
      const prf2 = crypto.getRandomValues(new Uint8Array(32));
      const key1 = await deriveKeyFromPrf(prf1);
      const key2 = await deriveKeyFromPrf(prf2);
      const plaintext = 'cross-key test';
      const encrypted = await encrypt(plaintext, key1);
      await expect(decrypt(encrypted, key2)).rejects.toThrow();
    });
  });

  describe('encrypt + decrypt', () => {
    it('roundtrips with password-derived key', async () => {
      const { key, salt } = await deriveKeyFromPassword('mypassword');
      const plaintext = '{"account":{"address":"abc123"},"balance":10000}';
      const encrypted = await encrypt(plaintext, key, salt);
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('roundtrips with PRF-derived key', async () => {
      const prfOutput = crypto.getRandomValues(new Uint8Array(32));
      const key = await deriveKeyFromPrf(prfOutput);
      const plaintext = 'prf encrypted data';
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('returns base64-encoded ciphertext and iv', async () => {
      const { key, salt } = await deriveKeyFromPassword('pw');
      const encrypted = await encrypt('test', key, salt);
      expect(typeof encrypted.ciphertext).toBe('string');
      expect(typeof encrypted.iv).toBe('string');
      expect(encrypted.ciphertext.length).toBeGreaterThan(0);
      expect(encrypted.iv.length).toBeGreaterThan(0);
    });

    it('includes salt only when provided', async () => {
      const prfOutput = crypto.getRandomValues(new Uint8Array(32));
      const key = await deriveKeyFromPrf(prfOutput);
      const withoutSalt = await encrypt('test', key);
      expect(withoutSalt.salt).toBeUndefined();

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const withSalt = await encrypt('test', key, salt);
      expect(withSalt.salt).toBeDefined();
    });

    it('produces different ciphertext for same plaintext (random IV)', async () => {
      const { key } = await deriveKeyFromPassword('pw');
      const encrypted1 = await encrypt('same data', key);
      const encrypted2 = await encrypt('same data', key);
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it('fails to decrypt with wrong key', async () => {
      const { key: key1 } = await deriveKeyFromPassword('password1');
      const { key: key2 } = await deriveKeyFromPassword('password2');
      const encrypted = await encrypt('secret', key1);
      await expect(decrypt(encrypted, key2)).rejects.toThrow();
    });

    it('handles empty string', async () => {
      const { key } = await deriveKeyFromPassword('pw');
      const encrypted = await encrypt('', key);
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toBe('');
    });

    it('handles large payloads', async () => {
      const { key } = await deriveKeyFromPassword('pw');
      const large = 'x'.repeat(100_000);
      const encrypted = await encrypt(large, key);
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toBe(large);
    });

    it('handles unicode content', async () => {
      const { key } = await deriveKeyFromPassword('pw');
      const unicode = '日本語テスト 🔐 Bitcoin ₿';
      const encrypted = await encrypt(unicode, key);
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toBe(unicode);
    });
  });
});
