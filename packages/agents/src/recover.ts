import { Contract, JsonRpcProvider, Wallet } from "ethers";
import {
  DEPLOYMENT_FILE,
  Deployment,
  readJson,
  requireIdentities,
} from "./config";

const ABI = [
  "function orderCount() view returns (uint256)",
  "function orders(uint256) view returns (address seller,uint256 price,uint256 deadline,uint256 reviewDeadline,bytes32 quoteDigest,bytes32 taskHash,bytes32 conversationHash,bytes32 resultHash,uint8 status)",
  "function refundExpired(uint256 orderId)",
  "function finalizeAfterReview(uint256 orderId)",
];

async function main() {
  const identities = requireIdentities();
  const deployment = readJson<Deployment>(DEPLOYMENT_FILE);
  if (deployment.chainId !== 296)
    throw new Error("Recovery requires a Hedera testnet deployment");
  const provider = new JsonRpcProvider(
    process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api",
    296,
  );
  const signer = new Wallet(identities.buyer.privateKey, provider);
  const contract = new Contract(deployment.address, ABI, signer);
  const latest = await provider.getBlock("latest");
  if (!latest) throw new Error("Could not read the latest testnet block");
  const count = Number(await contract.orderCount());
  let recovered = 0;

  for (let id = 1; id <= count; id++) {
    const order = await contract.orders(id);
    let action: "refundExpired" | "finalizeAfterReview" | undefined;
    if (Number(order.status) === 1 && BigInt(latest.timestamp) > order.deadline)
      action = "refundExpired";
    if (
      Number(order.status) === 2 &&
      BigInt(latest.timestamp) >= order.reviewDeadline
    )
      action = "finalizeAfterReview";
    if (!action) continue;
    const tx = await contract[action](id);
    await tx.wait();
    recovered++;
    console.log(
      `${action} order ${id}: https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${tx.hash}`,
    );
  }
  console.log(
    `Recovered ${recovered} of ${count} orders. Disputes require an arbiter decision.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
