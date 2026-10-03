# Agent Commerce Starter: coding agent guide

This is a Scaffold-HBAR community template. The core use case is autonomous agent-to-agent procurement on Hedera testnet. Follow the [bounty brief](https://hedera.com/blog/scaffold-hbar-template-bounty/) gate before adding features: external scaffold, valid `template.json`, separate Hardhat/Next packages, clean install/lint/build/boot, real testnet evidence, MIT licence, and no secrets.

Developer documentation: [first testnet run](docs/GETTING_STARTED.md), [architecture and trust boundaries](docs/ARCHITECTURE.md), [protocol specification](docs/TECHSPEC.md), and [service customization](docs/CUSTOMIZE.md). Keep these guides aligned with the implementation when changing setup, messages, signed terms, or verification.

## Source of truth

- `packages/hardhat/contracts/AgentCommerce.sol` owns budget limits, EIP-712 quote verification, order states, refunds, review period, and disputes.
- `packages/shared/src/index.ts` owns the versioned application message schemas, quote type/domain, canonical task and artifact hashes, and objective demo validator.
- `packages/agents/src/setup.ts` creates and registers the three HCS-10 agents. `demo.ts` runs the buyer and two sellers with distinct accounts and actual HCS topics.
- `packages/nextjs/lib/receipt.ts` validates public trade receipts. `packages/nextjs/lib/trade.ts` independently reads the mirror node and contract. The UI must never import secret agent files.

## Commands

Run from the repository root:

```bash
npm install
npm run lint
npm run build
npm test
npm run agents:setup
npm run hardhat:deploy -- --network hederaTestnet
npm run agents:demo
npm run agents:recover
npm run next:dev
```

Use Node 20.18.3+ and npm workspaces. Tests do not require testnet credentials; setup and demo do. Never commit `.env`, `.local/agents.json`, private keys, or generated output.

## Protocol invariants

- HCS-10 registration, discovery, connection, and messages must be real network operations. The `RFQ`, `QUOTE`, `AWARD`, and `DELIVERY` shapes are app messages inside HCS-10, not standard HCS-10 ops.
- A quote must include buyer contract, seller EVM address, task hash, HCS conversation hash, exact HBAR price, expiry, and unique nonce. Sign and verify it with the same EIP-712 domain and type in TypeScript and Solidity.
- Quote prices, limits, and contract balances are tinybar (8 decimals). Ethers transaction `value` uses 18-decimal weibar; convert deposits at the RPC boundary.
- Setup publishes HCS-11 profiles directly to HCS-1 topics and links account memos. The pinned SDK reads those profiles through its public KiloScribe CDN, while the canonical bytes remain on Hedera.
- The buyer checks the seller's HCS account and EVM alias before funding. The contract verifies the seller signature and spending policy; it cannot read HCS.
- Repeated messages, expired quotes, replayed signatures, duplicate settlements, wrong seller deliveries, and exceeded budgets must fail clearly.
- HCS messages are public. Keep user secrets and private artifacts off the topic.
- A result hash is evidence of bytes, not a general quality proof. Preserve the dispute path and document the arbiter's trust role.

## Editing guidance

Keep the demo executable without an LLM key. If adding a model-backed agent, make it an optional adapter with a deterministic fallback. Keep the app bootable with no `.env`. Update `README.md`, tests, and the verifier whenever message fields or contract terms change. Pin the HCS SDK to a tested version because HCS-10 is evolving.

Before a bounty submission, run the exact external scaffold command from a public repository into a fresh directory, then install, lint, build, boot, and verify routes. Add real Hashscan/mirror-node links to the README after a successful testnet run. Do not insert placeholder or fabricated transaction evidence.
