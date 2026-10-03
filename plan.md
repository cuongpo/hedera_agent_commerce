# Agent Commerce Starter — Scaffold-HBAR bounty plan

## Goal

Build a public, MIT-licensed Scaffold-HBAR template in which a **buyer agent autonomously purchases a service from a seller agent** on Hedera testnet. A developer should be able to scaffold the repository, supply funded testnet credentials, run the agents, and inspect a complete discovery → quote → purchase → delivery → settlement trail. After the owner funds a bounded budget, the happy path requires no human approval clicks.

Source of truth: [Scaffold-HBAR Template Bounty brief](https://hedera.com/blog/scaffold-hbar-template-bounty/). Submissions close **October 4, 2026 at 11:59 PM ET** (October 5 at 10:59 AM Vietnam time). The eligibility gate is pass/fail; scoring happens only after it passes.

## Product thesis

The reusable capability is **agent procurement with bounded spending and verifiable settlement**, rather than a marketplace UI. A buyer can discover a provider, negotiate a typed job, spend within an owner-set budget, verify the result, and pay automatically. A seller can advertise a capability and fulfill jobs. Developers replace the demo service and validation rule while retaining the commerce flow.

The Hashgraph Online HCS-10 integration is load-bearing: actual agent registration, discovery, connections, and quote/delivery messages use its protocol. A signed quote from that conversation is bound to a Hedera contract order. Removing HCS-10 removes interoperable agent discovery and negotiation; removing the contract removes enforceable spending limits and settlement. HCS-10 is currently marked Draft, so pin the SDK version and document the message schema used by this template. See the [HCS-10 specification](https://hol.org/docs/standards/hcs-10/) and [SDK documentation](https://hol.org/docs/libraries/standards-sdk/).

Existing work such as [Aivy Studio / Kickoff.bot](https://github.com/jmgomezl/aivy-studio) already demonstrates HCS-10 negotiation and escrow. Differentiate through a **one-command developer template**, an autonomous buyer with an on-chain spend policy, replaceable seller/validator interfaces, and an independent transaction verifier. Do not claim the concept is unprecedented.

## Judge-visible demo

1. Start one buyer agent and two seller agents with separate funded testnet identities. The sellers register a common demo capability with HCS-10 and advertise different prices.
2. Give the buyer a task and a maximum price. It discovers both sellers through the registry, opens HCS-10 connections, and sends a typed request for quote.
3. The sellers return signed quotes. The buyer checks capability, expiry, identity, and budget; it selects the cheapest valid quote without a human click.
4. The buyer calls the commerce contract through a budget account. The contract enforces the authorized buyer agent, maximum per order, total budget, exact price, seller signature, expiry, and one-time quote use. The funded order stores the quote digest and HCS conversation reference.
5. The selected seller produces a deterministic demo artifact, sends the delivery reference over HCS-10, and commits its digest on-chain. The buyer runs a replaceable validator against the actual artifact and releases payment automatically if valid.
6. The Next.js dashboard shows an interactive office replay of the buyer, sellers, and escrow, plus quotes, selected order, contract state, HCS topic/message references, and Hashscan or mirror-node transaction links. Label the replay as completed trade evidence, not a live monitor. A verifier page recomputes quote and artifact hashes from public evidence and labels each check separately.

The demo service should be a small reproducible data transformation with an objective validator and no external AI key. An optional model adapter may choose jobs or vendors, but **core commerce must run without an LLM**. The agent runners, rather than the web UI, initiate the purchase and settlement.

## Architecture

| Component          | Responsibility                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agents`  | Single-run buyer/seller demo with distinct keys, resumable setup, HCS-10 discovery and messages, quote selection, delivery, and expired-order recovery. |
| `packages/shared`  | Versioned request/quote/delivery schemas, canonical serialization and hashes, service and validator interfaces.                                         |
| `packages/hardhat` | Solidity commerce contract, deployment, meaningful contract tests, testnet configuration.                                                               |
| `packages/nextjs`  | Read-only commerce dashboard, verifier, setup state, mirror-node/contract reads.                                                                        |

Use **Next.js + Hardhat + npm workspaces + Node 20.18.3+** to match the bounty stack. Start from the official Scaffold-HBAR blank template layout, retain compatible manifest and scripts, and remove unrelated example contracts/pages. The template must scaffold through `npm create scaffold-hbar@latest -- --template cuongpo/hedera_agent_commerce`, not just work when cloned directly.

### Protocol boundary

- HCS-10 provides the registered identities and transport. `RFQ`, `QUOTE`, `AWARD`, and `DELIVERY` are this template's **application-level** messages carried inside HCS-10 messages; they are not HCS-10 standard operations.
- The quote is signed by the seller's EVM key and includes buyer/seller addresses, task digest, price, expiry, nonce, and connection topic. The contract verifies the signature and enforces replay protection. The verifier checks that the same quote appeared in the HCS conversation.
- The contract cannot read HCS directly. The README and UI must state that the HCS-to-contract match is checked by clients/verifier, while the contract enforces the signed commercial terms.
- Put only public metadata and content hashes on HCS. A write-controlled connection topic does not make its messages confidential.
- Bind each HCS agent identity to its EVM signer explicitly, and verify that mapping before funding. Do not rely on an unverified display name.

### Settlement states

`FUNDED → DELIVERED → PAID` is the normal path. If the seller misses the delivery deadline, the buyer can trigger a refund. If a delivered result fails validation, the buyer enters a documented dispute state; a configured arbiter can allocate the escrow. This is a trusted dispute mechanism, not automatic proof of work quality. Contract calls must be idempotent or reject duplicates clearly.

## Build order and exit checks

### 1. Eligibility skeleton

- Create the monorepo, valid `template.json`, npm workspace scripts, MIT licence, `.env.example`, `.gitignore`, initial `README.md`, and `AGENTS.md`.
- Prove a fresh external scaffold installs, lints, builds, boots, and returns OK on its core routes before adding complex features.

### 2. Commerce contract and tests

- Implement funded budget, authorized buyer agent, purchase from signed quote, delivery digest, release, timeout refund, and dispute resolution.
- Test unauthorized spending, over-budget orders, altered/expired/replayed quotes, double settlement, wrong seller delivery, and deadline behavior.

### 3. Real HCS-10 agents

- Register seller profiles, discover them from the buyer, establish connections, exchange typed messages, and preserve message sequence/transaction IDs.
- Run two sellers at different prices and show the buyer selecting a valid offer automatically. Make setup idempotent and document how to recover expired orders after a runner stops.

### 4. End-to-end testnet proof

- Deploy contract to Hedera testnet; run one complete agent-to-agent purchase and one failure-path transaction if time permits.
- Record contract address, HCS topics, and Hashscan or mirror-node links in the README. Verify that those links resolve publicly. Never commit keys or a real `.env` file.

### 5. Dashboard, documentation, and final gate

- Show the flow with an independent verifier and clear transaction links. The app should boot into a helpful setup state even when credentials are absent.
- Document prerequisites, account funding, environment variables, architecture, message schema, trust boundaries, extension points, demo commands, expected costs, failure recovery, and how to verify evidence.
- Repeat the **exact external scaffold command** into a fresh directory; run install, lint, build, route smoke check, contract tests, and the testnet demo. Submit the public repo link, testnet transaction link, and required dev-ex survey. If Hedera Harness is used, include its spec and validators with the submission.

### Documentation delivery

The bounty assigns **30 points** to docs quality. A developer unfamiliar with the repository must be able to move from scaffold to running app to understanding the pattern without help. Keep each document focused on a concrete reader task:

| Document                  | Reader's question                                                               | Acceptance check                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `README.md`               | What does this template do, how do I start, and where is the proof?             | The value proposition, exact scaffold command, demo outcome, and real mirror links are visible quickly.                       |
| `docs/GETTING_STARTED.md` | How do I reproduce the trade with my own testnet account?                       | A fresh developer can follow copyable commands, compare expected output, open both routes, and resolve common setup failures. |
| `docs/ARCHITECTURE.md`    | What does HCS-10 provide, what does the contract enforce, and what is trusted?  | Message fields, hashes, tinybar conversion, contract states, independent verification, and limits of the proof are explicit.  |
| `docs/TECHSPEC.md`        | What exact wire format and settlement rules must another implementation follow? | Message schemas, canonical hashes, EIP-712 fields, state transitions, verifier scope, and one public order match the code.    |
| `docs/CUSTOMIZE.md`       | How do I replace the statistics example?                                        | It names the exact schemas, runner, validator, verifier, contract terms, tests, and deployment steps to change.               |
| `AGENTS.md`               | What must a coding agent preserve?                                              | Commands, secret boundaries, signed-term invariants, and a final scaffold gate are concise and accurate.                      |

Before submission, follow the guides from a clean external scaffold of `cuongpo/hedera_agent_commerce`, check that every linked transaction resolves, and remove any claim that disagrees with the implementation. In particular, the operator key is ECDSA, quote and contract values are tinybar, the runner is a single process, and the dashboard reads the latest local public receipt. No private key, `.env`, or `.local/agents.json` belongs in the repo.

## Bounty gate and scoring map

### Public scaffold verification (October 3, 2026)

The public `cuongpo/hedera_agent_commerce` repository was scaffolded into a clean temporary directory with `npm create scaffold-hbar@latest -- hedera-agent-commerce-public-smoke --template cuongpo/hedera_agent_commerce --frontend nextjs-app --solidity-framework hardhat --package-manager npm --yes --skip-hedera-skills --skip-install`. The CLI fetched the GitHub tarball, then `npm ci`, `npm run lint`, `npm test` (2 shared and 5 contract tests), and `npm run build` passed. The production server returned HTTP 200 on `/` and `/verify` without credentials. A second clean scaffold using the README command without `--skip-install` also completed its dependency installation and formatting. After updating Next.js, a third fresh scaffold from the new public commit repeated `npm ci`, lint, all 7 tests, build, and both HTTP 200 route checks under Node 22.22.0. The already completed testnet trade and public transaction references are in the [README](README.md#submission-evidence); the fresh scaffold validation did not create a second funded testnet trade.

| Bounty criterion                     | Concrete evidence in this template                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| External scaffold and valid manifest | Exact `npm create scaffold-hbar@latest -- --template cuongpo/hedera_agent_commerce` fresh-run log; `template.json` capabilities/defaults. |
| Required structure and docs          | Separate contracts/frontend packages, `README.md`, `AGENTS.md`, MIT licence.                                                              |
| Install, lint, build, boot           | Root scripts and clean run from a newly generated project; core routes return OK.                                                         |
| Hedera and testnet proof             | Real HCS-10 topic activity and Solidity escrow transactions, linked to public explorer/mirror evidence.                                   |
| Ecosystem integration (35 points)    | Registry discovery and connection messages drive actual vendor selection; quote is bound to payment and independently verified.           |
| Documentation (30 points)            | Guided first run, architecture, security/trust notes, customization recipe, troubleshooting.                                              |
| Code quality (20 points)             | Typed protocol, small interfaces, meaningful tests, explicit errors, restart/replay handling.                                             |
| Hedera depth (15 points)             | HCS-10/HCS composition plus Hedera contract escrow and public verification.                                                               |

## Scope control and dependencies

**Ship first:** one task type, HBAR payments, two sellers, bounded buyer budget, objective result validation, one complete testnet trade, verifier, clean scaffold. A custom LLM, token payments, reputation, auctions, voice/chat UI, and cross-chain payments are follow-on work.

**Required for final submission:** a public GitHub repository and funded Hedera testnet ECDSA account(s). The faucet is linked in the bounty brief. Testnet transaction evidence cannot be produced without funding. Keep all private keys local; the repository contains only `.env.example`.

**Main technical risks:** HCS-10 SDK/API drift; identity mapping between HCS and EVM; mirror-node indexing lag; and disputes over subjective output. Mitigate by pinning dependencies, proving a minimal HCS-10 exchange before the full agent loop, using explicit signer mapping, retrying reads with bounded backoff, and choosing an objectively verifiable demo task.
