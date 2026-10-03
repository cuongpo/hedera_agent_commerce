import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import { config as loadEnv } from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(__dirname, "../..");
loadEnv({ path: path.join(root, ".env") });

const identitiesPath = path.join(root, ".local/agents.json");
const identities = fs.existsSync(identitiesPath)
  ? (JSON.parse(fs.readFileSync(identitiesPath, "utf8")) as {
      owner?: { privateKey: string };
    })
  : {};
const privateKey = identities.owner?.privateKey;
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: { evmVersion: "cancun", optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hederaTestnet: {
      url: process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: privateKey ? [privateKey] : [],
    },
  },
};

export default config;
