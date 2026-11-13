# x402 + Swap.io Agent API demo: an AI agent that pays per request

Demonstration of an autonomous AI agent paying for HTTP API requests on demand using the x402 protocol with USDC on Solana mainnet to access the Swap.io Agent API.

## What it is

This repository demonstrates the core mechanism of a payout agent:
1. An escrow release triggers the workflow with SOL.
2. The agent queries Swap.io for swap rates and pays a micropayment per request via x402.
3. The agent requests a compiled, unsigned swap transaction (e.g. SOL to USDC) from Swap.io via a second paid call.
4. The freelancer or client signs and submits the transaction with their own wallet. The agent never touches user private keys.

> **Note**: The end-to-end escrow payout workflow is an architectural concept. The two paid API requests demonstrated in this repository are real, executed transactions on Solana mainnet.

## How x402 works

The x402 payment flow enables per-request monetization over standard HTTP in 4 steps:
1. **Request**: The client/agent sends a standard HTTP request to the API endpoint (e.g. `POST /v1/swap/quote`).
2. **HTTP 402 with price**: The server returns `402 Payment Required` with payment specifications (amount in atomic USDC, recipient address, network).
3. **Pay USDC on Solana**: The client signs and broadcasts the micropayment on Solana, receiving a transaction signature attached via payment headers.
4. **Answer**: The server validates the payment on-chain and returns `200 OK` with the requested payload.

## Proof: Mainnet Settlement

Two paid API calls were executed on Solana mainnet by the test wallet `4b3jeGw2yCkeodkCHLecv74xVcofzCKuyqmNjPCuewve`:

- **Quote (`POST /v1/swap/quote`)**: [48HjLYaqFi1bxdxYhmQQaE835WDzTQeFxpoMYZ37R273X49uj5tooRsbT7VQ1GePXcCNHeEAknYNKU75JD86bBTy](https://solscan.io/tx/48HjLYaqFi1bxdxYhmQQaE835WDzTQeFxpoMYZ37R273X49uj5tooRsbT7VQ1GePXcCNHeEAknYNKU75JD86bBTy) (0.003007 USDC)
- **Build (`POST /v1/swap/build-tx`)**: [Y1WEXjNAShzEjPAxbaiGZsMeo13oF5uHhqm1mkkgh82veFJ1RcgN3dwgHRx7NgGJAHpx5jrqHg2JXDXCWtxFcDd](https://solscan.io/tx/Y1WEXjNAShzEjPAxbaiGZsMeo13oF5uHhqm1mkkgh82veFJ1RcgN3dwgHRx7NgGJAHpx5jrqHg2JXDXCWtxFcDd) (0.003 USDC)

*The swap transaction was received unsigned for demonstration purposes. The swap itself was not signed or sent.*

## Repository Structure

- `run_paid_calls.mjs` — Executes both paid calls (Quote and Build-TX) sequentially with spending caps.
- `raw_402.mjs` — Sends an unpaid request to demonstrate receiving the HTTP `402 Payment Required` challenge.
- `check_balance.mjs` — Checks the USDC and SOL balance of the test wallet.
- `gen_wallet.mjs` — Generates a new throwaway keypair into `secrets/payer.key`.

## Setup & Usage

### Prerequisites
- Node.js v20+ or v22+
- npm

### 1. Install dependencies
```bash
npm install
```

### 2. Generate test wallet
```bash
node gen_wallet.mjs
```
This creates `secrets/payer.key` (ignored by git, never commit).

### 3. Fund wallet
Fund the generated public address with a small amount of USDC (e.g. 0.50 USDC) and a small amount of SOL (e.g. 0.002 SOL) to cover network fees.

Check your balance:
```bash
node check_balance.mjs
```

### 4. Optional environment configuration
Copy `.env.example` to `.env` to configure a dedicated Solana RPC endpoint if desired:
```bash
cp .env.example .env
```
If omitted, public RPC endpoints will be used by default.

### 5. Inspect raw 402 challenge
```bash
node raw_402.mjs
```

### 6. Run paid calls
```bash
node run_paid_calls.mjs
```

## Security notes

- **Throwaway wallet only**: Use a throwaway wallet funded with only a few dollars.
- **Never commit keys**: Never commit or share `secrets/payer.key` or `.env`.
- **Spending safety caps**: `run_paid_calls.mjs` enforces client-side spending limits (0.01 USDC single call cap, 0.05 USDC session cap) before authorizing payments.

## Links

- Medium write-up: [An AI Agent That Pays Per Request: x402 and the Swap.io Agent API](https://medium.com/@OlenaHaponiuk/an-ai-agent-that-pays-per-request-x402-and-the-swap-io-agent-api-18b0fec19508)
- X post: [Demo Video & Announcement](https://x.com/Rosomaxa_solo/status/2121043604088975470)

