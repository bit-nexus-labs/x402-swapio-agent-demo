import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { base58 } from '@scure/base';
import { createKeyPairSignerFromBytes } from '@solana/kit';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve RPC URL from env var or .env with public fallback
let rpcUrl = process.env.RPC_URL;
const envPath = path.join(__dirname, '.env');
if (!rpcUrl && fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('RPC_URL=')) {
      rpcUrl = trimmed.substring('RPC_URL='.length).trim();
      break;
    }
  }
}

const RPCS = [
  ...(rpcUrl ? [rpcUrl] : []),
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
  'https://solana-mainnet.rpc.extrnode.com',
];
let address = process.argv[2];

if (!address) {
  const keyPath = path.join(__dirname, 'secrets', 'payer.key');
  if (!fs.existsSync(keyPath)) {
    console.error('Error: secrets/payer.key not found and no address provided.');
    process.exit(1);
  }
  const secretBase58 = fs.readFileSync(keyPath, 'utf8').trim();
  const secretBytes = base58.decode(secretBase58);
  const signer = await createKeyPairSignerFromBytes(secretBytes);
  address = signer.address;
}

let balance = 0;
let solBalance = 0;
let fetched = false;

for (const rpc of RPCS) {
  try {
    const resUsdc = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [
          address,
          { mint: USDC_MINT },
          { encoding: 'jsonParsed' },
        ],
      }),
    });
    const dataUsdc = await resUsdc.json();

    const resSol = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'getBalance',
        params: [address],
      }),
    });
    const dataSol = await resSol.json();

    if (dataUsdc && dataUsdc.result) {
      const accounts = dataUsdc.result.value || [];
      balance = accounts.reduce((sum, acc) => {
        const info = acc.account?.data?.parsed?.info?.tokenAmount;
        return sum + (info?.uiAmount || 0);
      }, 0);
    }

    if (dataSol && dataSol.result !== undefined) {
      solBalance = (dataSol.result.value ?? dataSol.result) / 1e9;
    }

    fetched = true;
    break;
  } catch (err) {
    // try next RPC
  }
}

if (!fetched) {
  console.error('Failed to query balance from RPCs');
  process.exit(1);
}

console.log(`Address: ${address}`);
console.log(`USDC Balance: ${balance.toFixed(6)} USDC`);
console.log(`SOL Balance: ${solBalance.toFixed(9)} SOL`);

if (balance < 0.5) {
  console.log(`STATUS: BELOW_MINIMUM (balance ${balance.toFixed(6)} < 0.5 USDC)`);
  process.exit(1);
} else {
  console.log(`STATUS: FUNDED (${balance.toFixed(6)} USDC >= 0.5 USDC)`);
}

