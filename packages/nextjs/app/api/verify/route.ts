import { publicReceiptSchema } from "../../../lib/receipt";
import { verifyTrade } from "../../../lib/trade";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16_384;

export async function POST(request: Request) {
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES)
    return Response.json(
      { error: "Receipt is too large (16 KB maximum)." },
      { status: 413 },
    );

  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return Response.json(
      { error: "Enter a valid JSON receipt." },
      { status: 400 },
    );
  }
  const parsed = publicReceiptSchema.safeParse(input);
  if (!parsed.success)
    return Response.json(
      {
        error:
          "Receipt format is invalid. Use .local/last-trade.json from a completed testnet run.",
      },
      { status: 400 },
    );

  try {
    const checks = await verifyTrade(parsed.data);
    return Response.json({
      orderId: parsed.data.orderId,
      contractAddress: parsed.data.contractAddress,
      payout: parsed.data.transactions.payout,
      checks,
    });
  } catch (reason) {
    return Response.json(
      {
        error:
          reason instanceof Error
            ? `Public verification could not complete: ${reason.message}`
            : "Public verification could not complete.",
      },
      { status: 502 },
    );
  }
}
