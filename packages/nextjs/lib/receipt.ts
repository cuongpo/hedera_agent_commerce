import { taskSchema } from "@agent-commerce/shared";
import { z } from "zod";

const accountId = z.string().regex(/^\d+\.\d+\.\d+$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const sequence = z.number().int().positive().safe();
const identity = z.object({ accountId, evmAddress: address }).strict();

export const publicReceiptSchema = z
  .object({
    network: z.literal("testnet"),
    chainId: z.literal(296),
    contractAddress: address,
    buyer: identity,
    sellers: z.array(identity).min(2).max(8),
    task: taskSchema,
    orderId: sequence,
    selectedSellerAccountId: accountId,
    offers: z
      .array(
        z
          .object({
            sellerAccountId: accountId,
            topicId: accountId,
            sequence,
            price: z.string().regex(/^[1-9]\d{0,77}$/),
          })
          .strict(),
      )
      .min(2)
      .max(8),
    conversationTopicId: accountId,
    quoteSequence: sequence,
    awardSequence: sequence,
    deliverySequence: sequence,
    transactions: z
      .object({ purchase: hash, delivery: hash, payout: hash })
      .strict(),
    resultHash: hash,
  })
  .strict();

export type PublicReceipt = z.infer<typeof publicReceiptSchema>;
