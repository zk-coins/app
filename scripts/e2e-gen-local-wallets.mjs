#!/usr/bin/env node
/**
 * Local-only: mint two fixture mnemonics and print their blossom op pubkeys
 * so ZKCOINS_BLOSSOM_ALLOWED_OPS can be extended before globalSetup mints.
 *
 * stdout JSON: { alice: { mnemonic, op }, bob: { mnemonic, op } }
 * Does not print to stderr except errors.
 */
import { generateMnemonic, bip340NormaliseSecret, encodeHexLower } from '@zkcoins/sdk';
import { HDKey } from '@scure/bip32';
import { seedFromMnemonicV1, ZKCOINS_PURPOSE } from '@zkcoins/sdk';

function opPubkeyHex(mnemonic) {
  const seed = seedFromMnemonicV1(mnemonic);
  const path = `m/${ZKCOINS_PURPOSE}'/0'/2'`;
  const child = HDKey.fromMasterSeed(seed).derive(path);
  if (!child.privateKey) throw new Error(`no key at ${path}`);
  return encodeHexLower(bip340NormaliseSecret(child.privateKey).pkBytes);
}

const alice = await generateMnemonic();
const bob = await generateMnemonic();
const create = await generateMnemonic();
if (typeof alice !== 'string' || typeof bob !== 'string' || typeof create !== 'string') {
  throw new Error('generateMnemonic did not return a string');
}
process.stdout.write(
  JSON.stringify({
    alice: { mnemonic: alice, op: opPubkeyHex(alice) },
    bob: { mnemonic: bob, op: opPubkeyHex(bob) },
    create: { mnemonic: create, op: opPubkeyHex(create) },
  }),
);
