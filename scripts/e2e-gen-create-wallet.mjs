import {
  generateMnemonic,
  bip340NormaliseSecret,
  encodeHexLower,
  seedFromMnemonicV1,
  ZKCOINS_PURPOSE,
} from '@zkcoins/sdk';
import { HDKey } from '@scure/bip32';

const mnemonic = await generateMnemonic();
const seed = seedFromMnemonicV1(mnemonic);
const child = HDKey.fromMasterSeed(seed).derive(`m/${ZKCOINS_PURPOSE}'/0'/2'`);
if (!child.privateKey) throw new Error('no op key');
const op = encodeHexLower(bip340NormaliseSecret(child.privateKey).pkBytes);
process.stdout.write(JSON.stringify({ mnemonic, op }));
