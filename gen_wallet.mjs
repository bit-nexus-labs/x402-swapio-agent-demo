import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const secretsDir = path.join(__dirname, 'secrets');
if (!fs.existsSync(secretsDir)) {
  fs.mkdirSync(secretsDir, { recursive: true });
}

const keypair = await Keypair.generate();
const secretBase58 = bs58.encode(keypair.secretKey);
const keyPath = path.join(secretsDir, 'payer.key');

fs.writeFileSync(keyPath, secretBase58, { encoding: 'utf8' });

console.log(keypair.publicKey.toBase58());

