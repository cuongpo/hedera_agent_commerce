# Agent commerce protocol specification

This is the implementation reference for `agent-commerce/1` on Hedera testnet. It describes the exact message shapes, hashes, signatures, settlement rules, and verification scope of this template. For setup, use [Getting started](GETTING_STARTED.md); for a conceptual walkthrough, use [Architecture](ARCHITECTURE.md). The [shared schemas](../packages/shared/src/index.ts), [agent runner](../packages/agents/src/demo.ts), [contract](../packages/hardhat/contracts/AgentCommerce.sol), and [verifier](../packages/nextjs/lib/trade.ts) are the executable sources of truth if this document and code diverge.

## Network, identities, and transport

| Item                 | Value in this template                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Network              | Hedera testnet, EVM chain ID `296`                                                                                                  |
| Application protocol | `agent-commerce/1`                                                                                                                  |
| Advertised service   | `commerce.stats.v1` in each HCS-11 profile and the registry memo                                                                    |
| Agents               | Buyer and two sellers, each with a separate Hedera ECDSA account and EVM alias; the owner controls the registry and contract budget |
| Discovery            | Owner-controlled HCS-10 registry, then HCS-11 profile and mirror-node alias checks                                                  |
| Conversation         | One HCS-10 connection topic per buyer–seller pair                                                                                   |
| Escrow               | One deployed `AgentCommerce` contract; `buyerAgent` and `arbiter` are fixed at deployment                                           |

The application payload is a JSON string in the HCS-10 outer envelope's `data` field. The SDK creates the envelope with `p: "hcs-10"` and `op: "message"`; `operator_id` identifies the submitting HCS account in the observed message. A mirror-node REST response encodes the **entire outer envelope** as base64 in `message`. Decode that first, then parse `data` as JSON. The application payload is public and must contain no secrets. HCS-10 `connection_request` and `register` messages are SDK operations, not application payloads defined here.

The runner requires a fresh `QUOTE` after each RFQ on that connection and checks the HCS message sequence and seller account. The HCS `operator_id` field alone is not cryptographic proof of seller authorship. The seller's EIP-712 signature, the Hedera account's mirror-node EVM alias, and the seller-only `deliver` contract call provide the identity binding used by this demo.

## Application messages

All four payloads include `protocol: "agent-commerce/1"`. The shared package parses them as a discriminated union on `kind`. A `Hash` below is a `0x`-prefixed 32-byte hex string; `Address` is a `0x`-prefixed 20-byte EVM address; `AccountId` is a Hedera `shard.realm.num` string. Numeric HBAR amounts are **positive decimal strings of tinybar**, not JSON numbers.

```ts
type Task = {
  capability: "commerce.stats.v1";
  records: { id: string; value: number }[]; // 1–20 entries; nonempty id, finite value
};
type Artifact = { count: number; sum: number; average: number };
type Quote = {
  buyer: Address; // escrow contract address, not the RFQ buyer address
  seller: Address; // seller EVM alias and signing address
  taskHash: Hash;
  conversationHash: Hash;
  price: string; // positive decimal tinybar
  deadline: number; // Unix seconds; quote expiry and delivery deadline
  nonce: Hash; // unique per quote
};

type RFQ = {
  protocol: "agent-commerce/1";
  kind: "RFQ";
  task: Task;
  buyer: Address;
  maxPrice: string;
  replyBy: number;
};
type QUOTE = {
  protocol: "agent-commerce/1";
  kind: "QUOTE";
  quote: Quote;
  signature: string;
  sellerAccountId: AccountId;
};
type AWARD = {
  protocol: "agent-commerce/1";
  kind: "AWARD";
  quoteDigest: Hash;
  orderId: number;
};
type DELIVERY = {
  protocol: "agent-commerce/1";
  kind: "DELIVERY";
  orderId: number;
  artifact: Artifact;
  resultHash: Hash;
};
```

The actual `taskSchema`, `quoteSchema`, and delivery `artifact` schema are strict about their fields. RFQ, QUOTE, AWARD, and DELIVERY outer objects are parsed by their Zod schemas; do not assume every outer object rejects extra fields. The seller rejects an RFQ if `replyBy` has passed or `maxPrice` is below its price. The runner sets `replyBy` about **5 minutes** after the RFQ and the quote `deadline` about **15 minutes** after signing. The buyer filters expired quotes and prices above its fixed **0.1 HBAR** policy, then chooses the lowest valid quote among the two observed sellers. A fresh random 32-byte `nonce` makes each quote unique.

## Hashes, signature, and units

Hashes are Keccak-256 of UTF-8 bytes; the canonical JSON field order is part of this version's wire contract:

```text
taskHash         = keccak256(utf8(JSON.stringify({ capability, records: [{ id, value }, ...] })))
conversationHash = keccak256(utf8(connectionTopicId))
resultHash       = keccak256(utf8(JSON.stringify({ count, sum, average })))
```

`connectionTopicId` is the Hedera topic string such as `0.0.10834806`, with no URL or prefix. The statistics result is `count = records.length`, `sum = sum(record.value)`, and `average = sum / count`, using JavaScript numbers. The buyer checks these values against the delivered artifact and checks `resultHash` against both that artifact and the on-chain order. Change the canonical encodings and protocol version together when changing the task or artifact shape.

The seller signs the following EIP-712 struct. The signature covers **all seven fields**, including the HCS topic hash, exact tinybar price, deadline, and nonce:

```text
EIP712Domain(name="AgentCommerce", version="1", chainId=296,
             verifyingContract=<deployed AgentCommerce address>)
Quote(address buyer,address seller,bytes32 taskHash,bytes32 conversationHash,
      uint256 price,uint256 deadline,bytes32 nonce)
```

`quoteDigest` is the EIP-712 typed-data digest, as returned by `contract.quoteDigest(quote)` or `TypedDataEncoder.hash(domain, quoteTypes, quoteValues(quote))`. The seller's `signature` is a 65-byte ECDSA signature represented by 130 hex digits after `0x`. `quote.buyer` is the **contract address**, while `RFQ.buyer` is the buyer agent's EVM address. The contract's immutable `buyerAgent` limits who may call `buy`.

One HBAR is **100,000,000 tinybar**. The example seller B price `"3000000"` means **0.03 HBAR**. Quote prices, on-chain caps, order prices, and the Solidity `msg.value` observed by this contract use tinybar. Ethers JSON-RPC transaction `value` uses 18-decimal weibar at the relay boundary: the owner deposits 0.1 HBAR with `parseEther("0.1")`, while the 0.1 HBAR contract cap is `parseUnits("0.1", 8)`. See the [Hedera unit guide](https://docs.hedera.com/hedera/sdks-and-apis/sdks/smart-contracts/ethereum-transaction).

## Escrow rules

The owner deposits an available budget before the buyer calls `buy`. A purchase requires the authorized buyer agent; a nonzero buyer contract, seller, task hash, conversation hash, nonce, and price; `deadline > block.timestamp`; a valid seller signature; an unused quote digest; `price <= maxPerOrder`; enough `availableBudget`; and `usedAllowance + price <= maxTotalSpend`. `buy` consumes the quote once, moves `price` from available budget to escrow, increases `usedAllowance`, and emits `OrderFunded`.

| Status      | Value | Entry and allowed exit                                                                                                                                   |
| ----------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `None`      |   `0` | No order at this ID.                                                                                                                                     |
| `Funded`    |   `1` | `buy`; seller may `deliver` through the deadline, or anyone may `refundExpired` **after** it.                                                            |
| `Delivered` |   `2` | Seller commits a nonzero `resultHash`; buyer may `accept`, buyer may `dispute` before review ends, or anyone may `finalizeAfterReview` once review ends. |
| `Disputed`  |   `3` | Only the configured arbiter may `resolveDispute(orderId, paySeller)` to pay or refund.                                                                   |
| `Paid`      |   `4` | Terminal; HBAR sent to the seller.                                                                                                                       |
| `Refunded`  |   `5` | Terminal; escrow returned to the owner's **available contract budget**, and `usedAllowance` decreases.                                                   |

`deliver` is seller-only and may occur when `block.timestamp <= deadline`. It starts a **one-day** review window. `dispute` is buyer-only and requires `block.timestamp < reviewDeadline`; `finalizeAfterReview` is permissionless at `block.timestamp >= reviewDeadline`. `accept` is buyer-only while the order is `Delivered`; the contract itself does not check artifact quality or impose a review deadline on `accept`. The agent runner validates the artifact first. A failed validation triggers `dispute` and leaves final payment or refund to the arbiter. `npm run agents:recover` handles only expired `Funded` orders and review-complete `Delivered` orders, never disputes. A refunded quote remains consumed, so recovery requires a new quote for another purchase.

## Public verification and example

The `/verify` route uses `.local/last-trade.json` locally, or the bundled public example receipt on Vercel, as a **list of public references**. Users can submit another public receipt through the form; `POST /api/verify` validates its testnet schema and runs the same checks. The verifier fetches the listed HCS quote and delivery messages, Hedera account aliases, contract order, and three EVM transaction receipts. Its 14 checks cover the two recorded signed offers, selected price, seller identity, task and conversation hashes, validated artifact, escrow terms, result digest, paid status, and successful purchase/delivery/payout receipts. It does **not** recheck RFQ or AWARD messages, HCS-11 profile/registry state, transaction event contents, or sellers outside the selected receipt. A green page means the recorded trade satisfies these checks; the receipt itself is not a signed or exhaustive market history.

The [public testnet run](../README.md#submission-evidence) has contract `0x81987Deb28b575B55B7f03C2aAeCe2C445c2eda0` and order `1`:

| Step               | Public reference                                                                                                                                                                                                                                      | Relevant value                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| RFQ                | [Topic `0.0.10834806`, sequence 1](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10834806/messages/1)                                                                                                                                       | Stats task `4, 6, 8`; maximum `10000000` tinybar.                                                                             |
| Seller A quote     | [Topic `0.0.10834803`, sequence 2](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10834803/messages/2)                                                                                                                                       | `5000000` tinybar.                                                                                                            |
| Seller B quote     | [Topic `0.0.10834806`, sequence 2](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10834806/messages/2)                                                                                                                                       | `3000000` tinybar; `sellerAccountId` `0.0.10834728`.                                                                          |
| Purchase and AWARD | [Contract result](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xe841d46c6b42779cbb7688498c3428ad72131ef58b08b39007ffd01b6ed68732), [topic sequence 3](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10834806/messages/3) | `quoteDigest` `0x60de0c718380c5d890ad8b86512e666eb7ab62b69f3f19cc54a72fa73aa21925`.                                           |
| DELIVERY           | [Topic `0.0.10834806`, sequence 4](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10834806/messages/4)                                                                                                                                       | `{ "count": 3, "sum": 18, "average": 6 }`; `resultHash` `0xea2ee352098ba41aa6af71a8572694b41c422a5d5ce8a76564357bc91fcf9625`. |
| Payout             | [Contract result](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x84f6489fa3c462b5b841cd4445d71f5d0bb22157b73a7cd8ee9acc99518d3c75)                                                                                                  | Order status `Paid` (`4`).                                                                                                    |

To independently inspect a topic message, fetch its mirror URL and base64-decode the returned `message`, then JSON-parse the outer envelope and its `data` field. [Architecture](ARCHITECTURE.md#walk-through-the-included-testnet-order) includes a copyable Node command. To implement another service, follow [Customize](CUSTOMIZE.md) and update this spec whenever its wire format or contract terms change.
