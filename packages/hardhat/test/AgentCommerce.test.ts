import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { Contract, Signer } from "ethers";

describe("AgentCommerce", () => {
  async function fixture() {
    const [owner, buyer, seller, arbiter, stranger] = await ethers.getSigners();
    const maxPerOrder = ethers.parseUnits("0.1", 8);
    const contract = await (
      await ethers.getContractFactory("AgentCommerce")
    ).deploy(
      buyer.address,
      arbiter.address,
      maxPerOrder,
      ethers.parseUnits("1", 8),
    );
    await contract.waitForDeployment();
    // The Hardhat signer declaration trails ethers' newer Signer helper methods.
    const asSigner = (signer: typeof owner) =>
      contract.connect(signer as unknown as Signer) as Contract;
    await asSigner(owner).deposit({ value: ethers.parseUnits("0.5", 8) });
    const deadline = (await time.latest()) + 3600;
    const quote = {
      buyer: await contract.getAddress(),
      seller: seller.address,
      taskHash: ethers.keccak256(ethers.toUtf8Bytes("task")),
      conversationHash: ethers.keccak256(ethers.toUtf8Bytes("0.0.123")),
      price: ethers.parseUnits("0.05", 8),
      deadline,
      nonce: ethers.hexlify(ethers.randomBytes(32)),
    };
    const domain = {
      name: "AgentCommerce",
      version: "1",
      chainId: 31337,
      verifyingContract: await contract.getAddress(),
    };
    const types = {
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
    const signature = await seller.signTypedData(domain, types, quote);
    return {
      contract,
      asSigner,
      owner,
      buyer,
      seller,
      arbiter,
      stranger,
      quote,
      signature,
    };
  }

  it("enforces signed terms, budget and replay protection", async () => {
    const { contract, asSigner, buyer, stranger, quote, signature } =
      await fixture();
    await expect(
      asSigner(stranger).buy(quote, signature),
    ).to.be.revertedWithCustomError(contract, "NotBuyerAgent");
    await expect(
      asSigner(buyer).buy(
        { ...quote, price: ethers.parseUnits("0.06", 8) },
        signature,
      ),
    ).to.be.revertedWithCustomError(contract, "InvalidQuote");
    await expect(
      asSigner(buyer).buy(
        { ...quote, price: ethers.parseUnits("0.2", 8) },
        signature,
      ),
    ).to.be.revertedWithCustomError(contract, "BudgetExceeded");
    await expect(asSigner(buyer).buy(quote, signature)).to.emit(
      contract,
      "OrderFunded",
    );
    await expect(
      asSigner(buyer).buy(quote, signature),
    ).to.be.revertedWithCustomError(contract, "QuoteUsed");
    expect(await contract.availableBudget()).to.equal(
      ethers.parseUnits("0.45", 8),
    );
  });

  it("settles only a seller delivery accepted by the buyer agent", async () => {
    const { contract, asSigner, buyer, seller, stranger, quote, signature } =
      await fixture();
    await asSigner(buyer).buy(quote, signature);
    const resultHash = ethers.keccak256(ethers.toUtf8Bytes("result"));
    await expect(
      asSigner(stranger).deliver(1, resultHash),
    ).to.be.revertedWithCustomError(contract, "NotSeller");
    await expect(asSigner(seller).deliver(1, resultHash)).to.emit(
      contract,
      "ResultDelivered",
    );
    await expect(asSigner(buyer).accept(1)).to.changeEtherBalance(
      seller,
      quote.price,
    );
    await expect(asSigner(buyer).accept(1)).to.be.revertedWithCustomError(
      contract,
      "InvalidState",
    );
  });

  it("refunds an undelivered order after its deadline", async () => {
    const { contract, asSigner, buyer, quote, signature } = await fixture();
    await asSigner(buyer).buy(quote, signature);
    await expect(contract.refundExpired(1)).to.be.revertedWithCustomError(
      contract,
      "DeadlineNotReached",
    );
    await time.increaseTo(quote.deadline + 1);
    await expect(contract.refundExpired(1)).to.emit(contract, "OrderRefunded");
    expect(await contract.availableBudget()).to.equal(
      ethers.parseUnits("0.5", 8),
    );
    expect(await contract.usedAllowance()).to.equal(0);
  });

  it("lets anyone settle a delivered order after the review window", async () => {
    const { contract, asSigner, buyer, seller, stranger, quote, signature } =
      await fixture();
    await asSigner(buyer).buy(quote, signature);
    await asSigner(seller).deliver(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("result")),
    );
    await expect(
      asSigner(stranger).finalizeAfterReview(1),
    ).to.be.revertedWithCustomError(contract, "ReviewWindowNotReached");
    const order = await contract.orders(1);
    await time.increaseTo(Number(order.reviewDeadline));
    await expect(
      asSigner(stranger).finalizeAfterReview(1),
    ).to.changeEtherBalance(seller, quote.price);
    await expect(
      asSigner(stranger).finalizeAfterReview(1),
    ).to.be.revertedWithCustomError(contract, "InvalidState");
  });

  it("lets the arbiter resolve a disputed result", async () => {
    const {
      contract,
      asSigner,
      buyer,
      seller,
      arbiter,
      stranger,
      quote,
      signature,
    } = await fixture();
    await asSigner(buyer).buy(quote, signature);
    await asSigner(seller).deliver(
      1,
      ethers.keccak256(ethers.toUtf8Bytes("bad result")),
    );
    await asSigner(buyer).dispute(1);
    await expect(
      asSigner(stranger).resolveDispute(1, false),
    ).to.be.revertedWithCustomError(contract, "NotArbiter");
    await asSigner(arbiter).resolveDispute(1, false);
    expect(await contract.availableBudget()).to.equal(
      ethers.parseUnits("0.5", 8),
    );
  });
});
