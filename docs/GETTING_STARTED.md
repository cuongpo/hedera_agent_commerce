# Run the agent commerce demo

This guide takes a new Scaffold-HBAR project from an empty dashboard to a paid agent-to-agent order on Hedera **testnet**. The agents run as a CLI process; the Next.js app displays and verifies their public evidence. No LLM key or browser wallet is needed.

## Before you start

- Node.js 20.18.3 or newer, npm, and Git.
- A funded **ECDSA** Hedera testnet operator account. Its private key must be a raw HEX ECDSA key. Get testnet HBAR through the [Hedera Portal](https://portal.hedera.com/faucet).
- At least 20 testnet HBAR for the four demo accounts at the default 5 HBAR each, plus network fees. Increase this if you change `AGENT_INITIAL_HBAR`.

Keep the operator key in a local `.env` file. Do not paste it into chat, an issue, a screenshot, or a public repository. The setup command writes four more private keys to `.local/agents.json`; that file needs the same care.

## 1. Scaffold and install

Scaffold from the public [agent commerce repository](https://github.com/cuongpo/hedera_agent_commerce):

```bash
npm create scaffold-hbar@latest -- agent-commerce-demo \
  --template cuongpo/hedera_agent_commerce \
  --frontend nextjs-app --solidity-framework hardhat \
  --package-manager npm --yes --skip-hedera-skills
cd agent-commerce-demo
```

The CLI installs dependencies during scaffolding. If you are working directly in this repository, run `npm install` here instead. The app can already show its setup state with `npm run next:dev`; funded credentials are required only for the on-chain run.

## 2. Configure the operator

```bash
cp .env.example .env
chmod 600 .env
```

Edit `.env` and fill `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY`. The ID must belong to the same ECDSA key. `HEDERA_RPC_URL` and `HEDERA_MIRROR_URL` already point at testnet defaults. The setup command reads the key locally and does not print it.

| Setting                   | Default | Effect                                                     |
| ------------------------- | ------- | ---------------------------------------------------------- |
| `AGENT_INITIAL_HBAR`      | `5`     | HBAR sent to each of four new ECDSA accounts.              |
| `DEMO_MAX_PER_ORDER_HBAR` | `0.1`   | Maximum single order, fixed when the contract is deployed. |
| `DEMO_TOTAL_BUDGET_HBAR`  | `1`     | Total allowance committed by this contract.                |

`DEMO_MAX_PER_ORDER_HBAR` and `DEMO_TOTAL_BUDGET_HBAR` must be set **before deployment**; changing `.env` later does not change a deployed contract. The runner's demo RFQ and example prices remain 0.1, 0.05, and 0.03 HBAR unless you edit `packages/agents/src/demo.ts`.

## 3. Create agent identities and deploy

```bash
npm run agents:setup
npm run hardhat:deploy -- --network hederaTestnet
```

Setup creates an owner, buyer, and two seller accounts; HCS-10 inbound/outbound topics; HCS-11 profiles stored on HCS-1; and an owner-controlled registry. It prints public account and topic IDs, then saves private details in `.local/agents.json`. If setup is interrupted, rerun it: completed identities and registrations are reused.

Deployment prints a contract address and a mirror-node link. It writes `.local/deployment.json`; the demo reads this file automatically. Check that `chainId` is `296` (Hedera testnet). The owner account created by setup deploys the contract and initially acts as dispute arbiter.

## 4. Run a complete trade

```bash
npm run agents:demo
```

The buyer discovers two registered sellers, opens HCS-10 connections, sends an RFQ, checks two signed quotes, and selects the lower 0.03 HBAR offer. The runner funds a 0.1 HBAR contract budget if needed, purchases the service, validates the delivered statistics, and pays the seller. Successful output ends with an order ID, payout transaction link, and `.local/last-trade.json` receipt. Account, topic, contract, and transaction IDs will differ for every run.

The agent runner is a single process with separate keys for each role. Running it again creates another order and overwrites the dashboard's latest-trade receipt; earlier transactions remain public on Hedera.

## 5. Inspect and verify

```bash
npm run next:dev
```

Open `http://localhost:3000` for the dashboard and `http://localhost:3000/verify` for the independent checks. The office replay starts automatically and runs once through buyer → sellers → escrow → delivery → payout. Use Pause or the six step buttons to inspect a stage, or Replay again after it ends. Automatic playback is disabled when your system requests reduced motion. Its evidence links come from `.local/last-trade.json`; the scene is a replay of a completed trade, not a live agent monitor. The verifier reads the HCS quote and delivery through the mirror node, checks each recorded offer's EIP-712 signature and seller alias, recomputes hashes, and reads the contract order and transaction receipts. A complete run should pass **14 checks**. Its scope is the two offers recorded by this demo; it does not prove that these were the cheapest sellers in any global registry.

The repository's [public evidence table](../README.md#submission-evidence) shows a completed trade without requiring your credentials. Mirror-node contract-result URLs are used for Ethereum transaction hashes because they resolve directly.

## Recovery and common failures

```bash
npm run agents:recover
```

Recovery refunds **funded orders after their delivery deadline** and finalizes **delivered orders after the review window**. It does not decide disputes. A disputed order requires the configured arbiter to inspect evidence and call `resolveDispute`.

| Symptom                                                   | Check                                                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INVALID_SIGNATURE` during account creation               | Confirm the operator ID matches the raw HEX **ECDSA** private key in `.env`. The setup script parses it as ECDSA.                                                              |
| Insufficient balance or failed account creation           | The operator needs four initial balances plus transaction fees. Check `AGENT_INITIAL_HBAR` and the testnet mirror-node account balance.                                        |
| Profile or HCS message not yet visible                    | Mirror nodes and the SDK's public profile CDN can lag consensus. Wait briefly and rerun the interrupted command; setup reuses saved identities.                                |
| `BudgetExceeded` after changing prices or caps            | Quote prices and on-chain limits are **tinybar, 8 decimals**. Ethers transaction `value` is sent as **weibar, 18 decimals**. See [architecture](ARCHITECTURE.md#hbar-units).   |
| Dashboard shows setup instructions after a successful run | Start Next.js from the generated project root and confirm `.local/last-trade.json` exists there. The app reads a local receipt; it does not fetch arbitrary historical orders. |
| Result validation fails                                   | The buyer opens a dispute before the review window expires. Inspect the HCS delivery and on-chain hash; the arbiter decides payment or refund.                                 |

Before publishing, `git check-ignore .env .local/agents.json` should list both paths. Never commit either file.
