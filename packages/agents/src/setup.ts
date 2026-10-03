import {
  AccountCreateTransaction,
  AccountUpdateTransaction,
  Client,
  Hbar,
  PrivateKey,
  TopicMessageSubmitTransaction,
  TopicCreateTransaction,
} from "@hashgraph/sdk";
import {
  AIAgentCapability,
  AIAgentType,
  HCS10Client,
  HCS11Client,
  InboundTopicType,
  buildHcs10CreateOutboundTopicTx,
} from "@hashgraphonline/standards-sdk";
import { createHash } from "node:crypto";
import { brotliCompressSync } from "node:zlib";
import { Wallet, getAddress } from "ethers";
import { CAPABILITY } from "@agent-commerce/shared";
import {
  AGENTS_FILE,
  Identity,
  IdentityFile,
  readJson,
  requireEnv,
  writeJson,
} from "./config";
import fs from "node:fs";

const labels = ["owner", "buyer", "sellerA", "sellerB"] as const;

async function createIdentity(
  client: Client,
  initialHbar: number,
): Promise<Identity> {
  const key = PrivateKey.generateECDSA();
  const evmAddress = getAddress(`0x${key.publicKey.toEvmAddress()}`);
  const tx = await new AccountCreateTransaction()
    .setKey(key.publicKey)
    .setAlias(key.publicKey.toEvmAddress())
    .setInitialBalance(new Hbar(initialHbar))
    .execute(client);
  const receipt = await tx.getReceipt(client);
  if (!receipt.accountId)
    throw new Error("Account creation did not return an account ID");
  const privateKey = `0x${key.toStringRaw()}`;
  if (new Wallet(privateKey).address !== evmAddress)
    throw new Error("ECDSA / EVM address mismatch");
  return { accountId: receipt.accountId.toString(), privateKey, evmAddress };
}

function hcsClient(identity: Identity): HCS10Client {
  return new HCS10Client({
    network: "testnet",
    operatorId: identity.accountId,
    operatorPrivateKey: identity.privateKey,
    keyType: "ecdsa",
    logLevel: "info",
  });
}

async function publishProfile(
  name: "buyer" | "sellerA" | "sellerB",
  identity: Identity,
): Promise<string> {
  const key = PrivateKey.fromStringECDSA(identity.privateKey);
  const client = Client.forTestnet().setOperator(identity.accountId, key);
  try {
    const hcs11 = new HCS11Client({
      network: "testnet",
      auth: { operatorId: identity.accountId, privateKey: identity.privateKey },
      logLevel: "error",
    });
    const profile = hcs11.createAIAgentProfile(
      name === "buyer"
        ? "Commerce Buyer"
        : name === "sellerA"
          ? "Stats Seller A"
          : "Stats Seller B",
      AIAgentType.AUTONOMOUS,
      [AIAgentCapability.DATA_INTEGRATION],
      "deterministic-demo",
      {
        alias: `agent-commerce-${name}-${identity.accountId.replaceAll(".", "-")}`,
        bio:
          name === "buyer"
            ? "Autonomous buyer with bounded HBAR spending"
            : "Autonomous provider of verifiable statistics reports",
        properties: {
          commerceCapability: CAPABILITY,
          evmAddress: identity.evmAddress,
        },
        inboundTopicId: identity.inboundTopicId,
        outboundTopicId: identity.outboundTopicId,
      },
    );
    hcs11.getClient().close();
    const raw = Buffer.from(JSON.stringify(profile));
    const memo = `${createHash("sha256").update(raw).digest("hex")}:brotli:base64`;
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo(memo)
      .setSubmitKey(key.publicKey)
      .execute(client);
    const topicId = (await topicTx.getReceipt(client)).topicId?.toString();
    if (!topicId) throw new Error("HCS-1 profile topic was not created");
    const encoded = `data:application/json;base64,${brotliCompressSync(raw).toString("base64")}`;
    for (
      let offset = 0, order = 0;
      offset < encoded.length;
      offset += 700, order++
    ) {
      const chunk = JSON.stringify({
        o: order,
        c: encoded.slice(offset, offset + 700),
      });
      const response = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(chunk)
        .execute(client);
      await response.getReceipt(client);
    }
    const memoTx = await new AccountUpdateTransaction()
      .setAccountId(identity.accountId)
      .setAccountMemo(`hcs-11:hcs://1/${topicId}`)
      .execute(client);
    await memoTx.getReceipt(client);
    return topicId;
  } finally {
    client.close();
  }
}

async function register(
  name: "buyer" | "sellerA" | "sellerB",
  identity: Identity,
  ownerClient: HCS10Client,
  registryTopicId: string,
  save: (updated: Identity) => void,
): Promise<Identity> {
  if (
    identity.inboundTopicId &&
    identity.outboundTopicId &&
    identity.profileTopicId &&
    identity.registered
  )
    return identity;
  let updated = identity;
  if (!updated.outboundTopicId) {
    const key = PrivateKey.fromStringECDSA(updated.privateKey);
    const hedera = Client.forTestnet().setOperator(updated.accountId, key);
    try {
      const tx = buildHcs10CreateOutboundTopicTx({
        ttl: 60,
        adminKey: true,
        submitKey: true,
        operatorPublicKey: key.publicKey,
      }) as TopicCreateTransaction;
      const response = await tx.execute(hedera);
      const topicId = (await response.getReceipt(hedera)).topicId?.toString();
      if (!topicId) throw new Error(`Could not create ${name} outbound topic`);
      updated = { ...updated, outboundTopicId: topicId };
      save(updated);
    } finally {
      hedera.close();
    }
  }
  if (!updated.inboundTopicId) {
    const topicClient = hcsClient(updated);
    try {
      const topicId = await topicClient.createInboundTopic(
        updated.accountId,
        InboundTopicType.PUBLIC,
        60,
      );
      updated = { ...updated, inboundTopicId: topicId };
      save(updated);
    } finally {
      topicClient.getClient().close();
    }
  }
  if (!updated.profileTopicId) {
    const topicId = await publishProfile(name, updated);
    updated = { ...updated, profileTopicId: topicId };
    save(updated);
  }
  if (!updated.registered) {
    await ownerClient.registerAgent(
      registryTopicId,
      updated.accountId,
      updated.inboundTopicId!,
      `${CAPABILITY}:${name}`,
    );
    updated = { ...updated, registered: true };
    save(updated);
  }
  return updated;
}

async function main() {
  const operatorId = requireEnv("HEDERA_OPERATOR_ID");
  const operatorKey = requireEnv("HEDERA_OPERATOR_KEY");
  const client = Client.forTestnet().setOperator(
    operatorId,
    PrivateKey.fromStringECDSA(operatorKey),
  );
  const identities = fs.existsSync(AGENTS_FILE)
    ? readJson<IdentityFile>(AGENTS_FILE)
    : {};
  const initialHbar = Number(process.env.AGENT_INITIAL_HBAR || "5");
  if (!Number.isFinite(initialHbar) || initialHbar <= 0)
    throw new Error("AGENT_INITIAL_HBAR must be positive");
  let ownerClient: HCS10Client | undefined;
  try {
    for (const label of labels) {
      if (!identities[label]) {
        console.log(
          `Creating ${label} ECDSA account with ${initialHbar} testnet HBAR`,
        );
        identities[label] = await createIdentity(client, initialHbar);
        writeJson(AGENTS_FILE, identities);
      }
      if (label === "owner" && !identities.registryTopicId) {
        ownerClient = hcsClient(identities.owner!);
        const registry = await ownerClient.createRegistryTopic({
          adminKey: true,
          submitKey: true,
        });
        if (!registry.success || !registry.topicId)
          throw new Error(
            `HCS-10 registry topic creation failed: ${registry.error}`,
          );
        identities.registryTopicId = registry.topicId;
        writeJson(AGENTS_FILE, identities);
        console.log(`HCS-10 registry topic: ${registry.topicId}`);
      }
      if (label === "owner" && !ownerClient)
        ownerClient = hcsClient(identities.owner!);
      if (label !== "owner") {
        const current = identities[label]!;
        identities[label] = await register(
          label,
          current,
          ownerClient!,
          identities.registryTopicId!,
          (updated) => {
            identities[label] = updated;
            writeJson(AGENTS_FILE, identities);
          },
        );
      }
      console.log(
        `${label}: ${identities[label]!.accountId} / ${identities[label]!.evmAddress}`,
      );
    }
    console.log(
      `HCS-10 registry ${identities.registryTopicId} contains the buyer and sellers. Deploy the commerce contract next.`,
    );
  } finally {
    ownerClient?.getClient().close();
    client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
