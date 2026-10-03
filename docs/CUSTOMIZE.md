# Adapt the template to your service

The starter's statistics task exists to make the full trade reproducible without a model key. It is a concrete example, not a plugin interface. To use another service, edit the task, result, seller work, and buyer acceptance rule together while keeping the HCS-10 quote and escrow path.

## A concrete change: weighted statistics

Suppose sellers should produce a weighted total. A new task might contain the current `records` plus `multiplier: 2`; the result would contain `weightedSum`. This is a useful first change because the buyer can still check the answer objectively.

1. **Version the protocol and capability.** Change `CAPABILITY` and `PROTOCOL` in [`packages/shared/src/index.ts`](../packages/shared/src/index.ts), for example to `commerce.weighted-stats.v1` and `agent-commerce/2`. This prevents old messages from being silently treated as the new service.
2. **Change the schemas and canonical hashes.** Add `multiplier` to `taskSchema`, `weightedSum` to the delivery artifact schema, and the same fields to `canonicalTask` and `canonicalArtifact`. Every field that affects price or acceptance must be covered by a hash or by the signed quote. Keep the schemas strict and ensure both sides hash the same bytes.
3. **Implement seller work and buyer validation.** Update `calculateArtifact` and `validateArtifact` in the shared package. A buyer should verify the actual delivered artifact against the task before calling `accept`; the hash alone proves only which artifact was committed.
4. **Change the runner's demo task and offers.** Edit [`packages/agents/src/demo.ts`](../packages/agents/src/demo.ts), where the task, the two example seller prices, the 0.1 HBAR buyer limit, and the lowest-price selection rule are currently defined. Quote prices are tinybar; use `parseUnits(hbarAmount, 8)`.
5. **Publish matching profiles.** [`packages/agents/src/setup.ts`](../packages/agents/src/setup.ts) advertises `CAPABILITY` in the HCS-11 profile and registry memo. Its setup is idempotent: it will not rewrite profiles already marked registered in `.local/agents.json`. For a new capability, use a fresh scaffold/project directory and fresh testnet identities, or implement an explicit profile update. Settle or recover old orders before retiring their keys.
6. **Update the verifier and docs.** The [public verifier](../packages/nextjs/lib/trade.ts) uses the shared task and artifact helpers. Add any new checks that matter to your service, update the README example, [architecture guide](ARCHITECTURE.md), and [protocol specification](TECHSPEC.md), and keep public HCS messages free of secrets.

For a different task shape, these same steps apply. If you replace an objective computation with subjective work, the starter cannot automatically judge quality. Change the buyer acceptance policy and use the contract's dispute path where necessary. Do not autoaccept unverified output merely because its hash matches the seller's submitted hash.

## Keep signed terms consistent

You can change task content without changing the EIP-712 quote shape because `taskHash` binds the signed quote to the canonical task. If you add a **new commercial term** such as a service fee, milestone count, or cancellation rule, update all of these together:

- Solidity `Quote`, `QUOTE_TYPEHASH`, and order enforcement in [`AgentCommerce.sol`](../packages/hardhat/contracts/AgentCommerce.sol).
- TypeScript `quoteSchema`, `quoteTypes`, and `quoteValues` in the shared package.
- Seller signing and buyer purchase in the agent runner.
- Contract tests, shared signature tests, and verifier assertions.

Changing the signed quote type or contract policy requires a **new deployment**. Existing signatures and orders belong to the old contract and domain. Contract caps are also fixed at deployment; changing `.env` after deployment does not alter them.

## Test the extension

```bash
npm run lint
npm test
npm run build
```

Then use a funded **testnet** project to run setup, deploy, and a complete trade as described in [Getting started](GETTING_STARTED.md). Verify that the new artifact passes `/verify`, the order reaches `Paid`, both recorded quotes are bound to their HCS topics, and the mirror-node transaction links resolve. Add a meaningful contract test if you change payment, dispute, or timeout behavior.

Before publishing the adapted template, scaffold it from its **public GitHub repository** into a clean directory and repeat install, lint, build, route checks, and the testnet demonstration. The [bounty brief](https://hedera.com/blog/scaffold-hbar-template-bounty/) makes that fresh scaffold and public transaction evidence part of the eligibility gate.
