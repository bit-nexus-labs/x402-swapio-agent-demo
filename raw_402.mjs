import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { base58 } from '@scure/base';
import { createKeyPairSignerFromBytes } from '@solana/kit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.join(__dirname, 'secrets', 'payer.key');
const secretBase58 = fs.readFileSync(keyPath, 'utf8').trim();
const secretBytes = base58.decode(secretBase58);
const signer = await createKeyPairSignerFromBytes(secretBytes);
const payerAddress = signer.address;

const reviewDir = path.join(__dirname, 'review');
if (!fs.existsSync(reviewDir)) {
  fs.mkdirSync(reviewDir, { recursive: true });
}

const url = 'https://hermes.swap.io/v1/swap/quote';
const payload = {
  input: {
    token: 'So11111111111111111111111111111111111111112',
    amount: '10000000',
    chainKey: 'sol',
  },
  output: {
    token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    chainKey: 'sol',
  },
  userAddress: payerAddress,
  slippageBps: 50,
};

console.log(`Sending unpaid POST request to ${url}...`);
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});

console.log(`Status: ${res.status} ${res.statusText}`);
const bodyText = await res.text();
let bodyJson;
try {
  bodyJson = JSON.parse(bodyText);
} catch {
  bodyJson = bodyText;
}

const result = {
  url,
  status: res.status,
  statusText: res.statusText,
  headers: Object.fromEntries(res.headers.entries()),
  body: bodyJson,
};

const outPath = path.join(reviewDir, 'X402-01_402_body.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
console.log(`Saved 402 response to ${outPath}`);

