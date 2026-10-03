import assert from "node:assert/strict";
import test from "node:test";
import { Wallet, parseUnits, randomBytes, hexlify } from "ethers";
import {
  CAPABILITY,
  artifactHash,
  calculateArtifact,
  conversationHash,
  quoteDomain,
  quoteTypes,
  quoteValues,
  taskHash,
  validateArtifact,
  verifySellerQuote,
  type Quote,
  type Task,
} from "./index";

test("quote signature is bound to seller, contract and chain", async () => {
  const seller = Wallet.createRandom();
  const buyer = Wallet.createRandom();
  const task: Task = {
    capability: CAPABILITY,
    records: [{ id: "a", value: 4 }],
  };
  const quote: Quote = {
    buyer: buyer.address,
    seller: seller.address,
    taskHash: taskHash(task),
    conversationHash: conversationHash("0.0.123"),
    price: parseUnits("0.02", 8).toString(),
    deadline: 1900000000,
    nonce: hexlify(randomBytes(32)),
  };
  const signature = await seller.signTypedData(
    quoteDomain(296, buyer.address),
    quoteTypes,
    quoteValues(quote),
  );
  assert.equal(verifySellerQuote(quote, signature, 296, buyer.address), true);
  assert.equal(
    verifySellerQuote(
      { ...quote, price: parseUnits("0.03", 8).toString() },
      signature,
      296,
      buyer.address,
    ),
    false,
  );
  assert.equal(verifySellerQuote(quote, signature, 295, buyer.address), false);
});

test("artifact validation rejects altered results", () => {
  const task: Task = {
    capability: CAPABILITY,
    records: [
      { id: "a", value: 4 },
      { id: "b", value: 6 },
    ],
  };
  const artifact = calculateArtifact(task);
  assert.deepEqual(artifact, { count: 2, sum: 10, average: 5 });
  assert.equal(validateArtifact(task, artifact), true);
  assert.equal(validateArtifact(task, { ...artifact, sum: 11 }), false);
  assert.match(artifactHash(artifact), /^0x[0-9a-f]{64}$/);
});
