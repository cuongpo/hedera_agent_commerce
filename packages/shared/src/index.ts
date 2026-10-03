import {
  TypedDataDomain,
  getAddress,
  keccak256,
  toUtf8Bytes,
  verifyTypedData,
} from "ethers";
import { z } from "zod";

export const CAPABILITY = "commerce.stats.v1";
export const PROTOCOL = "agent-commerce/1";

const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const topic = z.string().regex(/^\d+\.\d+\.\d+$/);

export const taskSchema = z
  .object({
    capability: z.literal(CAPABILITY),
    records: z
      .array(z.object({ id: z.string().min(1), value: z.number().finite() }))
      .min(1)
      .max(20),
  })
  .strict();
export type Task = z.infer<typeof taskSchema>;

export const quoteSchema = z
  .object({
    buyer: address,
    seller: address,
    taskHash: hash,
    conversationHash: hash,
    price: z.string().regex(/^[1-9]\d*$/),
    deadline: z.number().int().positive(),
    nonce: hash,
  })
  .strict();
export type Quote = z.infer<typeof quoteSchema>;

export const rfqSchema = z.object({
  protocol: z.literal(PROTOCOL),
  kind: z.literal("RFQ"),
  task: taskSchema,
  buyer: address,
  maxPrice: z.string().regex(/^[1-9]\d*$/),
  replyBy: z.number().int().positive(),
});
export const offerSchema = z.object({
  protocol: z.literal(PROTOCOL),
  kind: z.literal("QUOTE"),
  quote: quoteSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  sellerAccountId: z.string().regex(/^\d+\.\d+\.\d+$/),
});
export const awardSchema = z.object({
  protocol: z.literal(PROTOCOL),
  kind: z.literal("AWARD"),
  quoteDigest: hash,
  orderId: z.number().int().positive(),
});
export const deliverySchema = z.object({
  protocol: z.literal(PROTOCOL),
  kind: z.literal("DELIVERY"),
  orderId: z.number().int().positive(),
  artifact: z
    .object({
      count: z.number().int().positive(),
      sum: z.number(),
      average: z.number(),
    })
    .strict(),
  resultHash: hash,
});

export const appMessageSchema = z.discriminatedUnion("kind", [
  rfqSchema,
  offerSchema,
  awardSchema,
  deliverySchema,
]);
export type AppMessage = z.infer<typeof appMessageSchema>;
export type Artifact = z.infer<typeof deliverySchema>["artifact"];

export const quoteTypes = {
  Quote: [
    { name: "buyer", type: "address" },
    { name: "seller", type: "address" },
    { name: "taskHash", type: "bytes32" },
    { name: "conversationHash", type: "bytes32" },
    { name: "price", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export function quoteDomain(
  chainId: number,
  contractAddress: string,
): TypedDataDomain {
  return {
    name: "AgentCommerce",
    version: "1",
    chainId,
    verifyingContract: getAddress(contractAddress),
  };
}

export function canonicalTask(task: Task): string {
  const parsed = taskSchema.parse(task);
  return JSON.stringify({
    capability: parsed.capability,
    records: parsed.records.map((record) => ({
      id: record.id,
      value: record.value,
    })),
  });
}

export function taskHash(task: Task): string {
  return keccak256(toUtf8Bytes(canonicalTask(task)));
}

export function conversationHash(topicId: string): string {
  return keccak256(toUtf8Bytes(topic.parse(topicId)));
}

export function quoteValues(quote: Quote) {
  const parsed = quoteSchema.parse(quote);
  return {
    ...parsed,
    buyer: getAddress(parsed.buyer),
    seller: getAddress(parsed.seller),
    price: BigInt(parsed.price),
    deadline: BigInt(parsed.deadline),
  };
}

export function verifySellerQuote(
  quote: Quote,
  signature: string,
  chainId: number,
  contractAddress: string,
): boolean {
  try {
    return (
      getAddress(
        verifyTypedData(
          quoteDomain(chainId, contractAddress),
          quoteTypes,
          quoteValues(quote),
          signature,
        ),
      ) === getAddress(quote.seller)
    );
  } catch {
    return false;
  }
}

export function calculateArtifact(task: Task): Artifact {
  const values = taskSchema.parse(task).records.map((record) => record.value);
  const sum = values.reduce((total, value) => total + value, 0);
  return { count: values.length, sum, average: sum / values.length };
}

export function canonicalArtifact(artifact: Artifact): string {
  return JSON.stringify({
    count: artifact.count,
    sum: artifact.sum,
    average: artifact.average,
  });
}

export function artifactHash(artifact: Artifact): string {
  return keccak256(toUtf8Bytes(canonicalArtifact(artifact)));
}

export function validateArtifact(task: Task, artifact: Artifact): boolean {
  const expected = calculateArtifact(task);
  return (
    expected.count === artifact.count &&
    expected.sum === artifact.sum &&
    expected.average === artifact.average
  );
}

export function parseAppMessage(data: string): AppMessage | null {
  try {
    return appMessageSchema.parse(JSON.parse(data));
  } catch {
    return null;
  }
}
