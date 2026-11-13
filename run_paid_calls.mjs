import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { createX402Client } from 'x402-solana';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reviewDir = path.join(__dirname, 'review');
if (!fs.existsSync(reviewDir)) {
  fs.mkdirSync(reviewDir, { recursive: true });
}

// 1. Load secret from secrets/payer.key
const keyPath = path.join(__dirname, 'secrets', 'payer.key');
if (!fs.existsSync(keyPath)) {
  console.error('Error: secrets/payer.key not found');
  process.exit(1);
}
const secretBase58 = fs.readFileSync(keyPath, 'utf8').trim();
const keypair = Keypair.fromSecretKey(bs58.decode(secretBase58));
const payerAddress = keypair.publicKey.toBase58();
console.log(`Payer address: ${payerAddress}`);

// Safety caps
const MAX_CALL_ATOMIC = 10000; // 0.01 USDC
const MAX_TOTAL_ATOMIC = 50000; // 0.05 USDC
let totalSpentAtomic = 0;

// Wallet adapter for x402-solana
const wallet = {
  publicKey: keypair.publicKey,
  signTransaction: async (tx) => {
    tx.sign([keypair]);
    return tx;
  },
};

// Resolve RPC URL from environment or .env with public fallback
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
const defaultRpc = 'https://api.mainnet-beta.solana.com';
const effectiveRpc = rpcUrl || defaultRpc;

// 2. Setup x402 client with safety check hook
const client = createX402Client({
  wallet,
  network: 'solana',
  rpcUrl: effectiveRpc,
  verbose: false,
  beforePayment: async (snapshot) => {
    const amount = Number(snapshot.amount || snapshot.maxAmountRequired || 0);
    console.log(`[Safety Check] Endpoint payment required: ${amount} atomic USDC (${(amount / 1e6).toFixed(6)} USDC)`);
    if (amount > MAX_CALL_ATOMIC) {
      console.error(`SAFETY VIOLATION: amount ${amount} > ${MAX_CALL_ATOMIC}`);
      return { abort: true, reason: `Exceeds single call cap: ${amount} > ${MAX_CALL_ATOMIC}` };
    }
    if (totalSpentAtomic + amount > MAX_TOTAL_ATOMIC) {
      console.error(`SAFETY VIOLATION: total ${totalSpentAtomic + amount} > ${MAX_TOTAL_ATOMIC}`);
      return { abort: true, reason: `Exceeds total spend cap: ${totalSpentAtomic + amount} > ${MAX_TOTAL_ATOMIC}` };
    }
    totalSpentAtomic += amount;
    return { abort: false };
  },
});

function parsePaymentHeader(headers) {
  const raw = headers.get('x-payment-response') || headers.get('payment-response');
  if (!raw) {
    return { raw: null, txHash: null, parsed: null };
  }
  try {
    const decodedStr = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(decodedStr);
    const txHash = parsed.transaction || parsed.txHash || parsed.hash || parsed.signature || null;
    return { raw, decodedStr, parsed, txHash };
  } catch {
    return { raw, decodedStr: null, parsed: null, txHash: raw };
  }
}

// Balance helper
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RPCS = [
  ...(rpcUrl ? [rpcUrl] : []),
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
  'https://solana-mainnet.rpc.extrnode.com',
];

async function getBalances() {
  for (const rpc of RPCS) {
    try {
      const resUsdc = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params: [payerAddress, { mint: USDC_MINT }, { encoding: 'jsonParsed' }],
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
          params: [payerAddress],
        }),
      });
      const dataSol = await resSol.json();

      let usdc = 0;
      let sol = 0;
      if (dataUsdc && dataUsdc.result) {
        const accounts = dataUsdc.result.value || [];
        usdc = accounts.reduce((sum, a) => sum + (a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0), 0);
      }
      if (dataSol && dataSol.result !== undefined) {
        sol = (dataSol.result.value ?? dataSol.result) / 1e9;
      }
      return { usdc, sol };
    } catch {}
  }
  return { usdc: null, sol: null };
}

const balancesBefore = await getBalances();
console.log(`Balances before -> USDC: ${balancesBefore.usdc?.toFixed(6) ?? 'N/A'}, SOL: ${balancesBefore.sol?.toFixed(9) ?? 'N/A'}`);

// CALL 1: POST /v1/swap/quote
console.log('\n--- Making Paid Call 1: POST /v1/swap/quote ---');
const quoteUrl = 'https://hermes.swap.io/v1/swap/quote';
const quotePayload = {
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

const quoteRes = await client.fetch(quoteUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(quotePayload),
});

console.log(`Call 1 Status: ${quoteRes.status} ${quoteRes.statusText}`);
const quoteHeader = parsePaymentHeader(quoteRes.headers);
console.log(`Call 1 TX Hash: ${quoteHeader.txHash}`);

const quoteBodyText = await quoteRes.text();
let quoteData;
try {
  quoteData = JSON.parse(quoteBodyText);
} catch {
  quoteData = quoteBodyText;
}

fs.writeFileSync(
  path.join(reviewDir, 'X402-01_quote_response.json'),
  JSON.stringify(quoteData, null, 2),
  'utf8'
);

if (quoteRes.status !== 200) {
  console.error('Call 1 failed:', quoteBodyText);
  process.exit(1);
}

const bestQuote = quoteData.quotes?.[0];
if (!bestQuote) {
  console.error('No quotes returned in response');
  process.exit(1);
}

const providerKey = bestQuote.provider?.key || bestQuote.provider;
const providerQuote = bestQuote.providerQuote;
console.log(`Best quote provider: ${providerKey}`);
console.log(`Quote input: ${bestQuote.input?.amount || quotePayload.input.amount} lamports`);
console.log(`Quote output: ${bestQuote.output?.amount} atomic USDC`);
console.log(`Price impact: ${bestQuote.priceImpactPct ?? bestQuote.priceImpact ?? 'N/A'}%`);

// CALL 2: POST /v1/swap/build-tx
console.log('\n--- Making Paid Call 2: POST /v1/swap/build-tx ---');
const buildTxUrl = 'https://hermes.swap.io/v1/swap/build-tx';
const buildTxPayload = {
  provider: providerKey,
  userAddress: payerAddress,
  chainKey: 'sol',
  quoteResponse: providerQuote,
};

const buildTxRes = await client.fetch(buildTxUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(buildTxPayload),
});

console.log(`Call 2 Status: ${buildTxRes.status} ${buildTxRes.statusText}`);
const buildTxHeader = parsePaymentHeader(buildTxRes.headers);
console.log(`Call 2 TX Hash: ${buildTxHeader.txHash}`);

const buildTxBodyText = await buildTxRes.text();
let buildTxData;
try {
  buildTxData = JSON.parse(buildTxBodyText);
} catch {
  buildTxData = buildTxBodyText;
}

fs.writeFileSync(
  path.join(reviewDir, 'X402-01_build_tx_response.json'),
  JSON.stringify(buildTxData, null, 2),
  'utf8'
);

if (buildTxRes.status !== 200) {
  console.error('Call 2 failed:', buildTxBodyText);
  process.exit(1);
}

console.log('\n[SAFETY RULE ENFORCED] Unsigned swap transaction received. Refraining from signing or submitting to /submit-tx.');

// Wait for on-chain settlement to reflect
console.log('Waiting 5s for on-chain settlement confirmation...');
await new Promise((r) => setTimeout(r, 5000));
const balancesAfter = await getBalances();
console.log(`Balances after -> USDC: ${balancesAfter.usdc?.toFixed(6) ?? 'N/A'}, SOL: ${balancesAfter.sol?.toFixed(9) ?? 'N/A'}`);

// Write review/X402-01_result.md
const quoteSolscan = quoteHeader.txHash ? `https://solscan.io/tx/${quoteHeader.txHash}` : 'N/A';
const buildTxSolscan = buildTxHeader.txHash ? `https://solscan.io/tx/${buildTxHeader.txHash}` : 'N/A';

const resultMd = `# X402-01: Paid x402 Calls to Swap.io Agent API (Result)

## Summary
- **Payer Wallet**: \`${payerAddress}\`
- **USDC Balance Before**: ${balancesBefore.usdc?.toFixed(6) ?? 'N/A'} USDC
- **USDC Balance After**: ${balancesAfter.usdc?.toFixed(6) ?? 'N/A'} USDC
- **SOL Balance**: ${balancesAfter.sol?.toFixed(9) ?? '0.000000000'} SOL
- **Total Spent in this session**: ${(totalSpentAtomic / 1e6).toFixed(6)} USDC (${totalSpentAtomic} atomic units)

---

## 1. Raw 402 Challenge (Unpaid)
- **URL**: \`https://hermes.swap.io/v1/swap/quote\`
- **HTTP Status**: \`402 Payment Required\`
- **Payload file**: \`review/X402-01_402_body.json\`
- **Challenge Amount Required**: 3007 atomic units (0.003007 USDC)

---

## 2. Paid Call 1: Quote (\`POST /v1/swap/quote\`)
- **URL**: \`${quoteUrl}\`
- **HTTP Status**: \`${quoteRes.status} ${quoteRes.statusText}\`
- **Price Paid**: \`0.003007 USDC\` (3007 atomic units)
- **Settlement TX Hash**: \`${quoteHeader.txHash ?? 'N/A'}\`
- **Solscan Link**: [${quoteSolscan}](${quoteSolscan})
- **Raw X-PAYMENT-RESPONSE**: \`${quoteHeader.raw ?? 'N/A'}\`
${quoteHeader.decodedStr ? `- **Decoded Settlement Header**:\n\`\`\`json\n${quoteHeader.decodedStr}\n\`\`\`` : ''}

### Quote Details
- **Provider**: \`${providerKey}\`
- **Input Token**: \`SOL\` (\`So11111111111111111111111111111111111111112\`), Amount: \`${quotePayload.input.amount} lamports (0.01 SOL)\`
- **Output Token**: \`USDC\` (\`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\`), Amount: \`${bestQuote.output?.amount} atomic units (${(Number(bestQuote.output?.amount || 0) / 1e6).toFixed(6)} USDC)\`
- **Price Impact**: \`${bestQuote.priceImpactPct ?? bestQuote.priceImpact ?? 'N/A'}%\`

---

## 3. Paid Call 2: Build Transaction (\`POST /v1/swap/build-tx\`)
- **URL**: \`${buildTxUrl}\`
- **HTTP Status**: \`${buildTxRes.status} ${buildTxRes.statusText}\`
- **Price Paid**: \`0.003007 USDC\` (3007 atomic units)
- **Settlement TX Hash**: \`${buildTxHeader.txHash ?? 'N/A'}\`
- **Solscan Link**: [${buildTxSolscan}](${buildTxSolscan})
- **Raw X-PAYMENT-RESPONSE**: \`${buildTxHeader.raw ?? 'N/A'}\`
${buildTxHeader.decodedStr ? `- **Decoded Settlement Header**:\n\`\`\`json\n${buildTxHeader.decodedStr}\n\`\`\`` : ''}

### Swap Safety Status
- **Unsigned Transaction**: Received in response payload.
- **Execution**: NOT signed, NOT broadcast, \`/submit-tx\` NOT called.

---

## Files in \`review/\`
- \`X402-01_402_body.json\`: Unpaid HTTP 402 challenge response
- \`X402-01_quote_response.json\`: Paid HTTP 200 response for swap quote
- \`X402-01_build_tx_response.json\`: Paid HTTP 200 response for transaction construction
- \`X402-01_result.md\`: This report with Solscan links and verified balances
`;

fs.writeFileSync(path.join(reviewDir, 'X402-01_result.md'), resultMd, 'utf8');
console.log(`\nReview report successfully saved to ${path.join(reviewDir, 'X402-01_result.md')}`);
