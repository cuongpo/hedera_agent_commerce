import fs from "node:fs";
import path from "node:path";
import hostedDemoReceipt from "../data/public-trade.json";
import {
  Contract,
  JsonRpcProvider,
  TypedDataEncoder,
  getAddress,
} from "ethers";
import {
  CAPABILITY,
  artifactHash,
  conversationHash,
  parseAppMessage,
  quoteDomain,
  quoteTypes,
  quoteValues,
  taskHash,
  validateArtifact,
  verifySellerQuote,
  type AppMessage,
} from "@agent-commerce/shared";
import { publicReceiptSchema, type PublicReceipt } from "./receipt";

export type { PublicReceipt } from "./receipt";

const root = path.resolve(process.cwd(), "../..");
const mirrorBase =
  process.env.HEDERA_MIRROR_URL ||
  "https://testnet.mirrornode.hedera.com/api/v1";
const rpcUrl = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";

export function readReceipt(): PublicReceipt | null {
  if (process.env.VERCEL === "1")
    return publicReceiptSchema.parse(hostedDemoReceipt);
  const file = path.join(root, ".local/last-trade.json");
  if (fs.existsSync(file))
    return publicReceiptSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  return null;
}

export function mirrorContractResult(hash: string): string {
  return `${mirrorBase}/contracts/results/${hash}`;
}

export function mirrorMessage(topicId: string, sequence: number): string {
  return `${mirrorBase}/topics/${topicId}/messages/${sequence}`;
}

async function getMirrorMessage(
  topicId: string,
  sequence: number,
): Promise<{ operatorId: string; app: AppMessage }> {
  const response = await fetch(mirrorMessage(topicId, sequence), {
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      `Mirror node returned ${response.status} for ${topicId} #${sequence}`,
    );
  const payload = (await response.json()) as {
    message: string;
    sequence_number: number;
  };
  if (payload.sequence_number !== sequence)
    throw new Error("Mirror node sequence mismatch");
  const hcs = JSON.parse(
    Buffer.from(payload.message, "base64").toString("utf8"),
  ) as { p?: string; op?: string; operator_id?: string; data?: string };
  if (
    hcs.p !== "hcs-10" ||
    hcs.op !== "message" ||
    !hcs.operator_id ||
    !hcs.data
  )
    throw new Error("Message is not an HCS-10 application message");
  const app = parseAppMessage(hcs.data);
  if (!app) throw new Error("Application message has an invalid schema");
  return { operatorId: hcs.operator_id, app };
}

async function getMirrorAlias(accountId: string): Promise<string> {
  const response = await fetch(`${mirrorBase}/accounts/${accountId}`, {
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      `Mirror node returned ${response.status} for account ${accountId}`,
    );
  const account = (await response.json()) as { evm_address?: string };
  if (!account.evm_address)
    throw new Error(`Account ${accountId} has no EVM alias`);
  return getAddress(account.evm_address);
}

export type Check = { label: string; passed: boolean; detail: string };

export async function verifyTrade(receipt: PublicReceipt): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (label: string, passed: boolean, detail: string) =>
    checks.push({ label, passed, detail });
  const offerRef = receipt.offers.find(
    (offer) => offer.sellerAccountId === receipt.selectedSellerAccountId,
  );
  if (!offerRef)
    return [
      {
        label: "Selected offer",
        passed: false,
        detail: "Selected seller is missing from receipt",
      },
    ];
  const [offerMessages, deliveryMessage, aliases] = await Promise.all([
    Promise.all(
      receipt.offers.map((offer) =>
        getMirrorMessage(offer.topicId, offer.sequence),
      ),
    ),
    getMirrorMessage(receipt.conversationTopicId, receipt.deliverySequence),
    Promise.all(
      receipt.sellers.map((seller) => getMirrorAlias(seller.accountId)),
    ),
  ]);
  const selectedIndex = receipt.offers.indexOf(offerRef);
  const quoteMessage = offerMessages[selectedIndex];
  if (
    quoteMessage.app.kind !== "QUOTE" ||
    deliveryMessage.app.kind !== "DELIVERY"
  ) {
    return [
      {
        label: "Message types",
        passed: false,
        detail: "Quote or delivery message has the wrong kind",
      },
    ];
  }
  const quote = quoteMessage.app.quote;
  const delivery = deliveryMessage.app;
  const selectedSeller = receipt.sellers.find(
    (seller) => seller.accountId === receipt.selectedSellerAccountId,
  );
  const offerChecks = offerMessages.map((message, index) => {
    const reference = receipt.offers[index];
    const seller = receipt.sellers.find(
      (item) => item.accountId === reference.sellerAccountId,
    );
    if (message.app.kind !== "QUOTE" || !seller) return false;
    const signed = message.app;
    return (
      message.operatorId.endsWith(`@${seller.accountId}`) &&
      signed.sellerAccountId === seller.accountId &&
      getAddress(signed.quote.seller) ===
        aliases[receipt.sellers.indexOf(seller)] &&
      verifySellerQuote(
        signed.quote,
        signed.signature,
        receipt.chainId,
        receipt.contractAddress,
      ) &&
      signed.quote.buyer.toLowerCase() ===
        receipt.contractAddress.toLowerCase() &&
      signed.quote.taskHash === taskHash(receipt.task) &&
      signed.quote.conversationHash === conversationHash(reference.topicId) &&
      signed.quote.price === reference.price
    );
  });
  check(
    "Observed offers",
    offerChecks.every(Boolean) && offerChecks.length >= 2,
    "Every recorded offer is a signed HCS-10 quote from its seller",
  );
  check(
    "HCS-10 seller",
    quoteMessage.operatorId.endsWith(`@${receipt.selectedSellerAccountId}`) &&
      quoteMessage.app.sellerAccountId === receipt.selectedSellerAccountId,
    "Quote appeared in the seller's HCS-10 conversation",
  );
  check(
    "Seller identity",
    !!selectedSeller &&
      getAddress(quote.seller) === getAddress(selectedSeller.evmAddress) &&
      getAddress(quote.seller) ===
        aliases[receipt.sellers.indexOf(selectedSeller)],
    "Quote signer matches the Hedera account's EVM alias on the mirror node",
  );
  check(
    "Signed quote",
    verifySellerQuote(
      quote,
      quoteMessage.app.signature,
      receipt.chainId,
      receipt.contractAddress,
    ),
    "EIP-712 signature covers exact commercial terms",
  );
  check(
    "Task and conversation",
    quote.taskHash === taskHash(receipt.task) &&
      quote.conversationHash ===
        conversationHash(receipt.conversationTopicId) &&
      receipt.task.capability === CAPABILITY,
    "Quote is bound to this task and HCS topic",
  );
  check(
    "Chosen price",
    offerChecks.every(Boolean) &&
      receipt.quoteSequence === offerRef.sequence &&
      receipt.conversationTopicId === offerRef.topicId &&
      quote.price === offerRef.price &&
      receipt.offers.every(
        (offer) => BigInt(quote.price) <= BigInt(offer.price),
      ),
    "Buyer chose the lowest independently verified offer",
  );
  check(
    "Delivery identity",
    deliveryMessage.operatorId.endsWith(`@${receipt.selectedSellerAccountId}`),
    "Delivery came from the selected seller's HCS-10 connection",
  );
  check(
    "Artifact",
    delivery.orderId === receipt.orderId &&
      validateArtifact(receipt.task, delivery.artifact) &&
      artifactHash(delivery.artifact) === delivery.resultHash,
    "Result passes the demo's objective validator",
  );

  const provider = new JsonRpcProvider(rpcUrl, receipt.chainId);
  const contract = new Contract(
    receipt.contractAddress,
    [
      "function orders(uint256) view returns (address seller,uint256 price,uint256 deadline,uint256 reviewDeadline,bytes32 quoteDigest,bytes32 taskHash,bytes32 conversationHash,bytes32 resultHash,uint8 status)",
    ],
    provider,
  );
  const order = await contract.orders(receipt.orderId);
  const digest = TypedDataEncoder.hash(
    quoteDomain(receipt.chainId, receipt.contractAddress),
    quoteTypes,
    quoteValues(quote),
  );
  check(
    "Escrow terms",
    getAddress(order.seller) === getAddress(quote.seller) &&
      order.price === BigInt(quote.price) &&
      order.quoteDigest === digest &&
      order.taskHash === quote.taskHash &&
      order.conversationHash === quote.conversationHash,
    "Contract order matches the signed HCS quote",
  );
  check(
    "On-chain result",
    order.resultHash === delivery.resultHash &&
      order.resultHash === receipt.resultHash,
    "Escrow contains the delivered artifact digest",
  );
  check(
    "Paid state",
    Number(order.status) === 4,
    "Escrow paid the selected seller",
  );

  const txs = await Promise.all(
    Object.entries(receipt.transactions).map(async ([kind, hash]) => ({
      kind,
      tx: await provider.getTransactionReceipt(hash),
    })),
  );
  for (const { kind, tx } of txs) {
    check(
      `${kind} transaction`,
      !!tx &&
        tx.status === 1 &&
        !!tx.to &&
        getAddress(tx.to) === getAddress(receipt.contractAddress),
      tx ? mirrorContractResult(tx.hash) : "Transaction not found",
    );
  }
  return checks;
}
