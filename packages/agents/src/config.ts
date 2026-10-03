import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

export const ROOT = path.resolve(__dirname, "../../..");
export const LOCAL = path.join(ROOT, ".local");
export const AGENTS_FILE = path.join(LOCAL, "agents.json");
export const DEPLOYMENT_FILE = path.join(LOCAL, "deployment.json");
export const RECEIPT_FILE = path.join(LOCAL, "last-trade.json");
loadEnv({ path: path.join(ROOT, ".env") });

export type Identity = {
  accountId: string;
  privateKey: string;
  evmAddress: string;
  inboundTopicId?: string;
  outboundTopicId?: string;
  profileTopicId?: string;
  registrationState?: unknown;
  registered?: boolean;
};
export type IdentityFile = {
  registryTopicId?: string;
  owner?: Identity;
  buyer?: Identity;
  sellerA?: Identity;
  sellerB?: Identity;
};
export type CompleteIdentityFile = Required<IdentityFile>;
export type Deployment = {
  address: string;
  chainId: number;
  network: string;
  transactionHash: string;
};

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  fs.chmodSync(file, 0o600);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required in .env`);
  return value;
}

export function requireIdentities(): CompleteIdentityFile {
  if (!fs.existsSync(AGENTS_FILE))
    throw new Error("Run npm run agents:setup first.");
  const identities = readJson<IdentityFile>(AGENTS_FILE);
  if (
    !identities.registryTopicId ||
    !identities.owner ||
    !identities.buyer ||
    !identities.sellerA ||
    !identities.sellerB ||
    !identities.sellerA.inboundTopicId ||
    !identities.sellerB.inboundTopicId
  ) {
    throw new Error(
      "Agent setup is incomplete. Run npm run agents:setup again.",
    );
  }
  return identities as CompleteIdentityFile;
}
