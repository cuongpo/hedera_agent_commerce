# Agent Commerce Starter

A [Scaffold-HBAR](https://github.com/hedera-dev/scaffold-hbar) template for autonomous agent-to-agent purchases on Hedera. A buyer agent discovers two HCS-10 registered sellers, requests signed quotes, selects the cheapest valid offer, funds an order from an owner-controlled budget, checks the delivered result, and releases HBAR. A Next.js page independently rechecks the HCS conversation and contract state.

The demo runs without an LLM or API key. The statistics service is deliberately small so developers can inspect the commercial protocol and replace the service and validator.

**Live demo:** [Agent commerce dashboard](https://hedera-agent-commerce.vercel.app/) · [independent trade verifier](https://hedera-agent-commerce.vercel.app/verify). The hosted dashboard replays a completed testnet purchase using a bundled public receipt; the verifier checks its HCS messages, signatures, contract state, and payout against public Hedera endpoints. The agent runner remains a local command.

**Start here:** [run the testnet demo](docs/GETTING_STARTED.md) · [understand the architecture](docs/ARCHITECTURE.md) · [read the protocol specification](docs/TECHSPEC.md) · [adapt the template](docs/CUSTOMIZE.md). The [public testnet evidence](#submission-evidence) below lets you inspect a completed trade before funding an account.

## Scaffold and run

Prerequisites: Node.js **20.18.3 or newer**, npm, Git, and a funded Hedera **testnet ECDSA** account from the [Hedera Portal faucet](https://portal.hedera.com/faucet). Setup creates four separate ECDSA accounts for the contract owner, buyer, and two sellers. The default setup transfers 5 testnet HBAR to each account, so the operator needs at least 20 HBAR plus fees. Keep the generated `.local/agents.json` file private; it contains keys.

```bash
npm create scaffold-hbar@latest -- agent-commerce-demo \
  --template cuongpo/hedera_agent_commerce \
  --frontend nextjs-app --solidity-framework hardhat \
  --package-manager npm --yes --skip-hedera-skills
cd agent-commerce-demo
cp .env.example .env
# Fill HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env
npm run agents:setup
npm run hardhat:deploy -- --network hederaTestnet
npm run agents:demo
npm run next:dev
```

The scaffold command installs dependencies. Open `http://localhost:3000` for the trade dashboard and `http://localhost:3000/verify` for independent checks. The dashboard's interactive office scene automatically plays through the buyer, two sellers, and escrow once from the latest local public receipt; pause or choose a step to inspect it. Its links open the recorded HCS messages and contract transactions. Before setup, it shows an explicitly labeled illustration. For direct repository development, start with `npm install` and follow the same commands.

The expected happy path is two quotes (0.05 and 0.03 HBAR), seller B selected, and an `Autonomous trade settled` line with an order ID and public payout link. The verifier should pass 14 checks. Follow the [step-by-step guide](docs/GETTING_STARTED.md) if a command fails or a mirror-node result has not indexed yet.

The deploy command writes `.local/deployment.json`. The demo reads it automatically, deposits 0.1 testnet HBAR from the owner account if needed, and writes a public-only `.local/last-trade.json` receipt. The dashboard reads that receipt. Running the demo again creates another order and overwrites the displayed receipt; all old trades remain on Hedera.

Prices, spending caps, and contract balances use **tinybar (8 decimals)** because Hedera's EVM exposes `msg.value` in tinybar. The JSON-RPC transaction `value` sent by ethers uses **weibar (18 decimals)**, so the runner uses `parseEther` only for the deposit transaction and `parseUnits(value, 8)` for quotes and on-chain limits. See [Hedera's Ethereum transaction unit guide](https://docs.hedera.com/hedera/sdks-and-apis/sdks/smart-contracts/ethereum-transaction).

### Environment variables

| Variable                                            | Purpose                                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`         | Funded testnet account used only to create and fund the demo's ECDSA accounts.                  |
| `HEDERA_RPC_URL`                                    | Hedera JSON-RPC relay; defaults to Hashio testnet.                                              |
| `HEDERA_MIRROR_URL`                                 | Mirror-node REST API for identity and HCS evidence.                                             |
| `AGENT_INITIAL_HBAR`                                | Initial testnet HBAR per demo account; defaults to 5.                                           |
| `.local/agents.json`                                | Contains the testnet HCS-10 registry topic created during setup; it is generated automatically. |
| `DEMO_MAX_PER_ORDER_HBAR`, `DEMO_TOTAL_BUDGET_HBAR` | Contract spending caps set at deployment.                                                       |

Only `.env.example` belongs in Git among environment files. `.env`, `.local`, build output, and dependencies are ignored. The Vercel dashboard bundles the public-only receipt in `packages/nextjs/data/public-trade.json`; it never needs `.local/agents.json` or an operator key. Local scaffold runs use their own `.local/last-trade.json` after the demo.

## What happens on testnet

```text
Buyer agent          HCS-10 registry       Sellers A/B          AgentCommerce
     │ discover by capability │                  │                     │
     ├───────────────────────→│                  │                     │
     │ connect + RFQ over HCS-10────────────────→│                     │
     │←──────────────────────── signed quotes ───┤                     │
     │ choose cheapest valid quote               │                     │
     ├───────────────────────────── buy(quote, signature) ────────────→│
     │────────────────── AWARD over HCS-10 ─────→│                     │
     │←───────────────── DELIVERY + artifact ────┤── deliver(hash) ───→│
     │ validate artifact                         │                     │
     └────────────────────────────── accept(order) ───────────────────→│
```

HCS-10 provides agent registration, registry discovery, connections, and ordered messages. `RFQ`, `QUOTE`, `AWARD`, and `DELIVERY` are **application-level JSON messages** inside the HCS-10 `message` operation. The seller signs a quote using EIP-712. The contract checks the exact signature, task and conversation hashes, price, deadline, nonce, buyer, and seller. The buyer's contract account holds prepaid HBAR and enforces a maximum per order and total committed spend. See [HCS-10](https://hol.org/docs/standards/hcs-10/) and the [Hashgraph Online Standards SDK](https://hol.org/docs/libraries/standards-sdk/).

Setup creates an owner-controlled HCS-10 registry topic on testnet and records `register` messages for the buyer and sellers. It publishes each HCS-11 profile directly as an HCS-1 file and points the agent account memo at that topic, so publication needs no hosted inscription account. The buyer reads the registry and retrieves each seller profile through the pinned SDK's public KiloScribe CDN to check `DATA_INTEGRATION` and the template capability, then checks each Hedera account's EVM alias through the mirror node. The canonical profile bytes remain on Hedera; profile retrieval currently depends on that CDN endpoint. Developers can point their discovery adapter at a broader registry later. Each seller has its own key, topic, quote, and price. The decision rule is deterministic: choose the cheapest valid quote under 0.1 HBAR. There is no manual approval after initial account funding. The agent runner is in one process for a reproducible quickstart; buyer and sellers have separate identities and communicate through real HCS topics rather than in-memory calls.

### Replace the example service

1. Change the capability and task schema in `packages/shared/src/index.ts`.
2. Implement seller work in `calculateArtifact` or move it behind your service adapter.
3. Replace `validateArtifact` with an objective acceptance rule. For subjective work, use the dispute path.
4. Adjust prices and selection policy in `packages/agents/src/demo.ts`.
5. Add a contract test for any new payment behavior and rerun the testnet demo.

The included statistics task sums three records and verifies the count, sum, and average. This makes the commerce path runnable without model credentials. It is an example service, not a claim that computing a sum requires a marketplace.

## Trust and failure boundaries

- **HCS data is public.** HCS-10 connection topics restrict writers but do not encrypt messages. The template posts public metadata, quotes, and a small public artifact. Do not put secrets or private customer data in messages.
- **Cross-layer binding is independently checked.** A Solidity contract cannot read HCS directly. It verifies the seller's signed quote and its hashes; the buyer and `/verify` page check that the quote and delivery appeared in the referenced HCS conversation.
- **Quality is a separate question.** A digest proves which result was delivered. The demo validator checks an objective calculation; it cannot judge arbitrary work. If validation fails, the buyer opens a dispute. The configured arbiter (initially the owner) can release or refund the escrow.
- **Recovery paths exist.** An undelivered order can be refunded after the deadline. A delivered order can be paid by anyone after the review window if the buyer does not respond. The buyer must dispute a bad result before that window ends. Replayed quotes and duplicate settlement are rejected.
- **Runner restarts:** `npm run agents:recover` scans the deployed contract for expired undelivered orders and delivered orders past the review window, then invokes the corresponding public recovery function. It cannot decide a dispute; the owner acting as arbiter must inspect the evidence and call `resolveDispute`.
- **Budget isolation:** the buyer agent can call `buy` but cannot withdraw the owner's uncommitted balance. A compromised buyer key can still spend up to the on-chain caps on valid seller-signed quotes, so production deployments should set limits appropriate to their risk.
- **Indexing lag:** HCS and account queries use a mirror node, which may trail consensus. The runner polls for observed messages with bounded retries; rerun setup if registration was interrupted.

## Verify and develop

```bash
npm run lint
npm run build
npm test
```

The public verifier reads the HCS quote and delivery messages by topic and sequence, checks the seller's EIP-712 signature and account alias, recomputes the task and result digests, reads the contract order, and checks that the purchase, delivery, and payout transactions succeeded. It reports each assertion separately. It does not infer that every seller in the global registry was queried; it checks the two offers recorded by this demo.

The first complete trade ran on Hedera testnet on October 3, 2026. Seller A quoted 0.05 HBAR and seller B quoted 0.03 HBAR; the buyer selected B, accepted its validated result, and the contract paid B. The verifier passed all 14 checks against public HCS and EVM evidence. The [bounty brief](https://hedera.com/blog/scaffold-hbar-template-bounty/) also requires a fresh external scaffold from the published repository, valid `template.json`, README, `AGENTS.md`, MIT licence, clean install/lint/build/boot, no committed secrets, and the submission form's repo link, testnet evidence, and dev-ex survey. Hedera Harness is optional; this template does not use it.

### Submission evidence

| Evidence                                                      | Link                                                                                                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Testnet contract `0x81987Deb28b575B55B7f03C2aAeCe2C445c2eda0` | [Deployment transaction](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x49190ee82d6968787513ab3a048ce111e27876ca87012661900809536ca868c4) |
| HCS seller A quote, 0.05 HBAR                                 | [Mirror message 0.0.10834803 #2](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10834803/messages/2)                                               |
| HCS seller B quote, 0.03 HBAR                                 | [Mirror message 0.0.10834806 #2](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10834806/messages/2)                                               |
| HCS delivery                                                  | [Mirror message 0.0.10834806 #4](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10834806/messages/4)                                               |
| Escrow purchase transaction                                   | [Mirror result](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xe841d46c6b42779cbb7688498c3428ad72131ef58b08b39007ffd01b6ed68732)          |
| Result delivery transaction                                   | [Mirror result](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x45a3cca09d431cac42d9da7427ec09bb199e5fbf479980c70fbe2d39029eeecb)          |
| HBAR payout transaction                                       | [Mirror result](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x84f6489fa3c462b5b841cd4445d71f5d0bb22157b73a7cd8ee9acc99518d3c75)          |

## Repository map

| Path               | Contents                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `packages/hardhat` | Solidity contract, deployment script, contract tests.                                         |
| `packages/agents`  | ECDSA/HCS-10 setup and autonomous buyer/seller demo.                                          |
| `packages/shared`  | Typed application protocol, EIP-712 quote terms, hashes, deterministic service and validator. |
| `packages/nextjs`  | Dashboard and independent verifier.                                                           |
| `plan.md`          | Build plan mapped to the bounty rubric.                                                       |

Licence: MIT. This project is an independent community template and is not an official Hedera or Hashgraph Online product.
