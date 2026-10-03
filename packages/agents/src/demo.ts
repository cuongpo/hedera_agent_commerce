import { AIAgentCapability, HCS10Client } from "@hashgraphonline/standards-sdk";
import {
  CAPABILITY,
  PROTOCOL,
  AppMessage,
  Quote,
  Task,
  artifactHash,
  calculateArtifact,
  conversationHash,
  parseAppMessage,
  quoteDomain,
  quoteTypes,
  quoteValues,
  taskHash,
  validateArtifact,
  verifySellerQuote,
} from "@agent-commerce/shared";
import {
  Contract,
  JsonRpcProvider,
  Log,
  Wallet,
  getAddress,
  hexlify,
  parseEther,
  parseUnits,
  randomBytes,
} from "ethers";
import {
  AGENTS_FILE,
  DEPLOYMENT_FILE,
  RECEIPT_FILE,
  CompleteIdentityFile,
  Deployment,
  Identity,
  readJson,
  requireIdentities,
  writeJson,
} from "./config";

const ABI = [
  "function deposit() payable",
  "function availableBudget() view returns (uint256)",
  "function buy((address buyer,address seller,bytes32 taskHash,bytes32 conversationHash,uint256 price,uint256 deadline,bytes32 nonce) quote, bytes sellerSignature) returns (uint256)",
  "function quoteDigest((address buyer,address seller,bytes32 taskHash,bytes32 conversationHash,uint256 price,uint256 deadline,bytes32 nonce) quote) view returns (bytes32)",
  "function deliver(uint256 orderId,bytes32 resultHash)",
  "function accept(uint256 orderId)",
  "function dispute(uint256 orderId)",
  "function orderCount() view returns (uint256)",
  "function orders(uint256) view returns (address seller,uint256 price,uint256 deadline,uint256 reviewDeadline,bytes32 quoteDigest,bytes32 taskHash,bytes32 conversationHash,bytes32 resultHash,uint8 status)",
  "event OrderFunded(uint256 indexed orderId, bytes32 indexed quoteDigest, address indexed seller, uint256 price, bytes32 conversationHash)",
];

type HcsMessage = {
  op?: string;
  data?: string;
  operator_id?: string;
  sequence_number: number;
  connection_id?: number;
  connection_topic_id?: string;
};
type Channel = {
  topicId: string;
  seller: Identity;
  sellerClient: HCS10Client;
  buyerClient: HCS10Client;
};
type Offer = {
  quote: Quote;
  signature: string;
  seller: Identity;
  channel: Channel;
  sequence: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hcsClient(identity: Identity): HCS10Client {
  return new HCS10Client({
    network: "testnet",
    operatorId: identity.accountId,
    operatorPrivateKey: identity.privateKey,
    keyType: "ecdsa",
    logLevel: "error",
  });
}

async function messages(
  client: HCS10Client,
  topicId: string,
): Promise<HcsMessage[]> {
  return (await client.getMessages(topicId)).messages as HcsMessage[];
}

async function waitForMessage(
  client: HCS10Client,
  topicId: string,
  fromAccount: string,
  kind: AppMessage["kind"],
  after = 0,
): Promise<{ message: AppMessage; sequence: number }> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const found = (await messages(client, topicId)).find((item) => {
      if (
        item.op !== "message" ||
        item.sequence_number <= after ||
        !item.operator_id?.endsWith(`@${fromAccount}`) ||
        !item.data
      )
        return false;
      return parseAppMessage(item.data)?.kind === kind;
    });
    if (found?.data)
      return {
        message: parseAppMessage(found.data)!,
        sequence: found.sequence_number,
      };
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for ${kind} on ${topicId}`);
}

async function openChannel(
  buyer: Identity,
  seller: Identity,
  buyerClient: HCS10Client,
  sellerClient: HCS10Client,
): Promise<Channel> {
  const inbound = seller.inboundTopicId;
  if (!inbound)
    throw new Error(`Seller ${seller.accountId} has no HCS-10 inbound topic`);
  const baseline = Math.max(
    0,
    ...(await messages(sellerClient, inbound)).map(
      (message) => message.sequence_number,
    ),
  );
  const request = await buyerClient.submitConnectionRequest(
    inbound,
    "Agent Commerce RFQ",
  );
  const requestSequence = request.topicSequenceNumber?.toNumber();
  if (!requestSequence)
    throw new Error("HCS-10 connection request has no sequence number");
  for (let attempt = 0; attempt < 45; attempt++) {
    const inboundMessages = await messages(sellerClient, inbound);
    const incoming = inboundMessages.find(
      (message) =>
        message.op === "connection_request" &&
        message.sequence_number === requestSequence &&
        message.sequence_number > baseline &&
        message.operator_id?.endsWith(`@${buyer.accountId}`),
    );
    if (incoming) {
      await sellerClient.handleConnectionRequest(
        inbound,
        buyer.accountId,
        requestSequence,
      );
      const confirmation = await buyerClient.waitForConnectionConfirmation(
        inbound,
        requestSequence,
        45,
        2000,
      );
      return {
        topicId: confirmation.connectionTopicId,
        seller,
        sellerClient,
        buyerClient,
      };
    }
    await sleep(2000);
  }
  throw new Error(
    `Seller ${seller.accountId} did not receive the HCS-10 connection request`,
  );
}

async function verifyRegistryAndAliases(
  buyerClient: HCS10Client,
  identities: CompleteIdentityFile,
): Promise<void> {
  const registrations = await messages(buyerClient, identities.registryTopicId);
  for (const seller of [identities.sellerA, identities.sellerB]) {
    const entry = registrations.find(
      (message) =>
        message.op === "register" &&
        (message as HcsMessage & { account_id?: string }).account_id ===
          seller.accountId,
    );
    if (!entry)
      throw new Error(
        `Seller ${seller.accountId} is missing from HCS-10 registry topic ${identities.registryTopicId}`,
      );
    const profile = await buyerClient.retrieveProfile(seller.accountId, true, {
      maxRetries: 3,
      retryDelay: 2000,
    });
    if (
      !profile.success ||
      profile.profile?.properties?.commerceCapability !== CAPABILITY ||
      !profile.profile?.aiAgent?.capabilities?.includes(
        AIAgentCapability.DATA_INTEGRATION,
      ) ||
      profile.topicInfo?.inboundTopic !== seller.inboundTopicId
    ) {
      throw new Error(
        `Seller ${seller.accountId} does not advertise the required HCS-11 capability`,
      );
    }
    const mirror =
      process.env.HEDERA_MIRROR_URL ||
      "https://testnet.mirrornode.hedera.com/api/v1";
    const accountResponse = await fetch(
      `${mirror}/accounts/${seller.accountId}`,
    );
    if (!accountResponse.ok)
      throw new Error(`Mirror node could not resolve ${seller.accountId}`);
    const account = (await accountResponse.json()) as { evm_address?: string };
    if (
      !account.evm_address ||
      getAddress(account.evm_address) !== getAddress(seller.evmAddress)
    ) {
      throw new Error(
        `HCS account / EVM signer mismatch for ${seller.accountId}`,
      );
    }
  }
}

async function requestOffer(
  channel: Channel,
  task: Task,
  buyerAddress: string,
  contractAddress: string,
  chainId: number,
  price: bigint,
): Promise<Offer> {
  const rfq: AppMessage = {
    protocol: PROTOCOL,
    kind: "RFQ",
    task,
    buyer: buyerAddress,
    maxPrice: parseUnits("0.1", 8).toString(),
    replyBy: Math.floor(Date.now() / 1000) + 300,
  };
  const rfqReceipt = await channel.buyerClient.sendMessage(
    channel.topicId,
    JSON.stringify(rfq),
    "Request for quote",
  );
  const rfqSeq = rfqReceipt.topicSequenceNumber?.toNumber() || 0;
  const received = await waitForMessage(
    channel.sellerClient,
    channel.topicId,
    channel.buyerClient.getClient().operatorAccountId!.toString(),
    "RFQ",
    rfqSeq - 1,
  );
  if (
    received.message.kind !== "RFQ" ||
    taskHash(received.message.task) !== taskHash(task)
  )
    throw new Error("Seller received a different task");
  if (
    BigInt(received.message.maxPrice) < price ||
    received.message.replyBy < Math.floor(Date.now() / 1000)
  )
    throw new Error("RFQ is expired or below seller price");

  const sellerWallet = new Wallet(channel.seller.privateKey);
  const quote: Quote = {
    buyer: contractAddress,
    seller: sellerWallet.address,
    taskHash: taskHash(task),
    conversationHash: conversationHash(channel.topicId),
    price: price.toString(),
    deadline: Math.floor(Date.now() / 1000) + 900,
    nonce: hexlify(randomBytes(32)),
  };
  const signature = await sellerWallet.signTypedData(
    quoteDomain(chainId, contractAddress),
    quoteTypes,
    quoteValues(quote),
  );
  const offer: AppMessage = {
    protocol: PROTOCOL,
    kind: "QUOTE",
    quote,
    signature,
    sellerAccountId: channel.seller.accountId,
  };
  const quoteReceipt = await channel.sellerClient.sendMessage(
    channel.topicId,
    JSON.stringify(offer),
    "Signed service quote",
  );
  const found = await waitForMessage(
    channel.buyerClient,
    channel.topicId,
    channel.seller.accountId,
    "QUOTE",
    rfqSeq,
  );
  if (
    found.message.kind !== "QUOTE" ||
    found.sequence !== quoteReceipt.topicSequenceNumber?.toNumber()
  )
    throw new Error("Quote was not observed on HCS-10");
  if (
    !verifySellerQuote(
      found.message.quote,
      found.message.signature,
      chainId,
      contractAddress,
    )
  )
    throw new Error("Seller quote signature invalid");
  if (
    getAddress(found.message.quote.seller) !==
      getAddress(channel.seller.evmAddress) ||
    found.message.sellerAccountId !== channel.seller.accountId
  )
    throw new Error("Seller identity mismatch");
  if (
    found.message.quote.taskHash !== taskHash(task) ||
    found.message.quote.conversationHash !== conversationHash(channel.topicId)
  )
    throw new Error("Quote does not match task or HCS conversation");
  return {
    quote: found.message.quote,
    signature: found.message.signature,
    seller: channel.seller,
    channel,
    sequence: found.sequence,
  };
}

async function main() {
  const identities = requireIdentities();
  const deployment = readJson<Deployment>(DEPLOYMENT_FILE);
  if (deployment.chainId !== 296)
    throw new Error(
      "Agent demo requires a Hedera testnet deployment (chain ID 296)",
    );
  const provider = new JsonRpcProvider(
    process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api",
    296,
  );
  const ownerWallet = new Wallet(identities.owner.privateKey, provider);
  const buyerWallet = new Wallet(identities.buyer.privateKey, provider);
  const ownerContract = new Contract(deployment.address, ABI, ownerWallet);
  const buyerContract = new Contract(deployment.address, ABI, buyerWallet);
  const buyerClient = hcsClient(identities.buyer);
  const sellerClients = [
    hcsClient(identities.sellerA),
    hcsClient(identities.sellerB),
  ];

  try {
    console.log(
      `Discovering sellers in HCS-10 registry ${identities.registryTopicId}...`,
    );
    await verifyRegistryAndAliases(buyerClient, identities);
    const requiredBudget = parseUnits("0.1", 8);
    if ((await ownerContract.availableBudget()) < requiredBudget) {
      const deposit = await ownerContract.deposit({ value: parseEther("0.1") });
      await deposit.wait();
      console.log(`Budget funded: ${deposit.hash}`);
    }

    const task: Task = {
      capability: CAPABILITY,
      records: [
        { id: "alpha", value: 4 },
        { id: "beta", value: 6 },
        { id: "gamma", value: 8 },
      ],
    };
    const channels = [
      await openChannel(
        identities.buyer,
        identities.sellerA,
        buyerClient,
        sellerClients[0],
      ),
      await openChannel(
        identities.buyer,
        identities.sellerB,
        buyerClient,
        sellerClients[1],
      ),
    ];
    console.log(
      `Opened HCS-10 channels ${channels.map((channel) => channel.topicId).join(", ")}`,
    );
    const offers = [
      await requestOffer(
        channels[0],
        task,
        identities.buyer.evmAddress,
        deployment.address,
        296,
        parseUnits("0.05", 8),
      ),
      await requestOffer(
        channels[1],
        task,
        identities.buyer.evmAddress,
        deployment.address,
        296,
        parseUnits("0.03", 8),
      ),
    ];
    const selected = offers
      .filter(
        (offer) =>
          BigInt(offer.quote.price) <= parseUnits("0.1", 8) &&
          offer.quote.deadline > Math.floor(Date.now() / 1000),
      )
      .sort((a, b) =>
        BigInt(a.quote.price) < BigInt(b.quote.price) ? -1 : 1,
      )[0];
    if (!selected)
      throw new Error(
        "No valid seller quote within the buyer's spending policy",
      );
    console.log(
      `Buyer selected ${selected.seller.accountId} at ${selected.quote.price} tinybar`,
    );

    const purchase = await buyerContract.buy(
      quoteValues(selected.quote),
      selected.signature,
    );
    const purchaseReceipt = await purchase.wait();
    const fundedEvent = (purchaseReceipt?.logs as Log[] | undefined)
      ?.map((log) => {
        try {
          return buyerContract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event) => event?.name === "OrderFunded");
    if (!fundedEvent)
      throw new Error(`Purchase ${purchase.hash} did not emit OrderFunded`);
    const orderId = Number(fundedEvent.args.orderId);
    const award: AppMessage = {
      protocol: PROTOCOL,
      kind: "AWARD",
      quoteDigest: await buyerContract.quoteDigest(quoteValues(selected.quote)),
      orderId,
    };
    const awardReceipt = await selected.channel.buyerClient.sendMessage(
      selected.channel.topicId,
      JSON.stringify(award),
      "Order funded",
    );
    const sellerAward = await waitForMessage(
      selected.channel.sellerClient,
      selected.channel.topicId,
      identities.buyer.accountId,
      "AWARD",
      (awardReceipt.topicSequenceNumber?.toNumber() || 1) - 1,
    );
    if (
      sellerAward.message.kind !== "AWARD" ||
      sellerAward.message.orderId !== orderId
    )
      throw new Error("Seller did not observe the funded order");

    const artifact = calculateArtifact(task);
    const resultHash = artifactHash(artifact);
    const sellerContract = new Contract(
      deployment.address,
      ABI,
      new Wallet(selected.seller.privateKey, provider),
    );
    const deliveryTx = await sellerContract.deliver(orderId, resultHash);
    await deliveryTx.wait();
    const delivery: AppMessage = {
      protocol: PROTOCOL,
      kind: "DELIVERY",
      orderId,
      artifact,
      resultHash,
    };
    const deliveryReceipt = await selected.channel.sellerClient.sendMessage(
      selected.channel.topicId,
      JSON.stringify(delivery),
      "Service delivery",
    );
    const buyerDelivery = await waitForMessage(
      selected.channel.buyerClient,
      selected.channel.topicId,
      selected.seller.accountId,
      "DELIVERY",
      (deliveryReceipt.topicSequenceNumber?.toNumber() || 1) - 1,
    );
    const order = await buyerContract.orders(orderId);
    if (
      buyerDelivery.message.kind !== "DELIVERY" ||
      !validateArtifact(task, buyerDelivery.message.artifact) ||
      buyerDelivery.message.resultHash !==
        artifactHash(buyerDelivery.message.artifact) ||
      order.resultHash !== buyerDelivery.message.resultHash
    ) {
      const disputeTx = await buyerContract.dispute(orderId);
      await disputeTx.wait();
      throw new Error(
        `Result failed validation; order disputed in ${disputeTx.hash}`,
      );
    }
    const payout = await buyerContract.accept(orderId);
    await payout.wait();

    const receipt = {
      network: "testnet",
      chainId: 296,
      contractAddress: deployment.address,
      buyer: {
        accountId: identities.buyer.accountId,
        evmAddress: identities.buyer.evmAddress,
      },
      sellers: [identities.sellerA, identities.sellerB].map((seller) => ({
        accountId: seller.accountId,
        evmAddress: seller.evmAddress,
      })),
      task,
      orderId,
      selectedSellerAccountId: selected.seller.accountId,
      offers: offers.map((offer) => ({
        sellerAccountId: offer.seller.accountId,
        topicId: offer.channel.topicId,
        sequence: offer.sequence,
        price: offer.quote.price,
      })),
      conversationTopicId: selected.channel.topicId,
      quoteSequence: selected.sequence,
      awardSequence: awardReceipt.topicSequenceNumber?.toNumber(),
      deliverySequence: deliveryReceipt.topicSequenceNumber?.toNumber(),
      transactions: {
        purchase: purchase.hash,
        delivery: deliveryTx.hash,
        payout: payout.hash,
      },
      resultHash,
    };
    writeJson(RECEIPT_FILE, receipt);
    console.log(
      `Autonomous trade settled. Order ${orderId}; payout ${payout.hash}`,
    );
    console.log(
      `Public proof: https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${payout.hash}`,
    );
    console.log(`Receipt: ${RECEIPT_FILE}`);
  } finally {
    buyerClient.getClient().close();
    for (const client of sellerClients) client.getClient().close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
