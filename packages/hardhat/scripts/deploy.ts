import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";

type AgentFile = {
  buyer: { evmAddress: string };
};

async function main() {
  const root = path.resolve(__dirname, "../../..");
  const agentPath = path.join(root, ".local/agents.json");
  if (!fs.existsSync(agentPath)) {
    throw new Error(
      "Run npm run agents:setup first. Expected .local/agents.json.",
    );
  }
  const agents = JSON.parse(fs.readFileSync(agentPath, "utf8")) as AgentFile;
  const [deployer] = await ethers.getSigners();
  const buyerAgent = agents.buyer.evmAddress;
  const maxPerOrder = ethers.parseUnits(
    process.env.DEMO_MAX_PER_ORDER_HBAR || "0.1",
    8,
  );
  const maxTotalSpend = ethers.parseUnits(
    process.env.DEMO_TOTAL_BUDGET_HBAR || "1",
    8,
  );
  const factory = await ethers.getContractFactory("AgentCommerce");
  const contract = await factory.deploy(
    buyerAgent,
    deployer.address,
    maxPerOrder,
    maxTotalSpend,
  );
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const tx = contract.deploymentTransaction();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  fs.mkdirSync(path.join(root, ".local"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".local/deployment.json"),
    JSON.stringify(
      { address, chainId, network: network.name, transactionHash: tx?.hash },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        address,
        chainId,
        transactionHash: tx?.hash,
        mirror:
          tx?.hash && chainId === 296
            ? `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${tx.hash}`
            : undefined,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
