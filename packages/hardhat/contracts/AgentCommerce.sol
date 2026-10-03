// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Owner-funded budget for an autonomous buyer agent and escrowed seller orders.
/// @dev HCS messages are checked by clients. This contract verifies signed commercial terms.
contract AgentCommerce is EIP712, ReentrancyGuard {
    enum Status { None, Funded, Delivered, Disputed, Paid, Refunded }

    struct Quote {
        address buyer;
        address seller;
        bytes32 taskHash;
        bytes32 conversationHash;
        uint256 price; // tinybar (8 decimals on Hedera EVM)
        uint256 deadline;
        bytes32 nonce;
    }

    struct Order {
        address seller;
        uint256 price;
        uint256 deadline;
        uint256 reviewDeadline;
        bytes32 quoteDigest;
        bytes32 taskHash;
        bytes32 conversationHash;
        bytes32 resultHash;
        Status status;
    }

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address buyer,address seller,bytes32 taskHash,bytes32 conversationHash,uint256 price,uint256 deadline,bytes32 nonce)"
    );
    uint256 public constant REVIEW_WINDOW = 1 days;

    address public immutable owner;
    address public immutable buyerAgent;
    address public immutable arbiter;
    uint256 public immutable maxPerOrder;
    uint256 public immutable maxTotalSpend;
    uint256 public availableBudget;
    uint256 public usedAllowance;
    uint256 public orderCount;

    mapping(uint256 => Order) public orders;
    mapping(bytes32 => bool) public usedQuotes;

    event BudgetDeposited(address indexed sender, uint256 amount);
    event BudgetWithdrawn(address indexed owner, uint256 amount);
    event OrderFunded(uint256 indexed orderId, bytes32 indexed quoteDigest, address indexed seller, uint256 price, bytes32 conversationHash);
    event ResultDelivered(uint256 indexed orderId, bytes32 resultHash, uint256 reviewDeadline);
    event OrderDisputed(uint256 indexed orderId);
    event OrderPaid(uint256 indexed orderId, address indexed seller, uint256 amount);
    event OrderRefunded(uint256 indexed orderId, uint256 amount);

    error NotOwner();
    error NotBuyerAgent();
    error NotSeller();
    error NotArbiter();
    error InvalidQuote();
    error QuoteExpired();
    error QuoteUsed();
    error BudgetExceeded();
    error InvalidState();
    error DeadlineNotReached();
    error ReviewWindowNotReached();
    error TransferFailed();

    constructor(address buyerAgent_, address arbiter_, uint256 maxPerOrder_, uint256 maxTotalSpend_)
        EIP712("AgentCommerce", "1")
    {
        if (buyerAgent_ == address(0) || arbiter_ == address(0) || maxPerOrder_ == 0 || maxTotalSpend_ < maxPerOrder_) {
            revert InvalidQuote();
        }
        owner = msg.sender;
        buyerAgent = buyerAgent_;
        arbiter = arbiter_;
        maxPerOrder = maxPerOrder_;
        maxTotalSpend = maxTotalSpend_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyBuyerAgent() {
        if (msg.sender != buyerAgent) revert NotBuyerAgent();
        _;
    }

    function deposit() external payable onlyOwner {
        if (msg.value == 0) revert BudgetExceeded();
        availableBudget += msg.value;
        emit BudgetDeposited(msg.sender, msg.value);
    }

    function withdrawUncommitted(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0 || amount > availableBudget) revert BudgetExceeded();
        availableBudget -= amount;
        (bool ok, ) = payable(owner).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit BudgetWithdrawn(owner, amount);
    }

    function quoteDigest(Quote calldata quote) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            QUOTE_TYPEHASH,
            quote.buyer,
            quote.seller,
            quote.taskHash,
            quote.conversationHash,
            quote.price,
            quote.deadline,
            quote.nonce
        ));
        return _hashTypedDataV4(structHash);
    }

    function buy(Quote calldata quote, bytes calldata sellerSignature) external onlyBuyerAgent returns (uint256 orderId) {
        if (quote.buyer != address(this) || quote.seller == address(0) || quote.taskHash == bytes32(0)
            || quote.conversationHash == bytes32(0) || quote.nonce == bytes32(0) || quote.price == 0) revert InvalidQuote();
        if (quote.deadline <= block.timestamp) revert QuoteExpired();
        if (quote.price > maxPerOrder || quote.price > availableBudget
            || usedAllowance + quote.price > maxTotalSpend) revert BudgetExceeded();

        bytes32 digest = quoteDigest(quote);
        if (usedQuotes[digest]) revert QuoteUsed();
        if (ECDSA.recover(digest, sellerSignature) != quote.seller) revert InvalidQuote();

        usedQuotes[digest] = true;
        availableBudget -= quote.price;
        usedAllowance += quote.price;
        orderId = ++orderCount;
        orders[orderId] = Order({
            seller: quote.seller,
            price: quote.price,
            deadline: quote.deadline,
            reviewDeadline: 0,
            quoteDigest: digest,
            taskHash: quote.taskHash,
            conversationHash: quote.conversationHash,
            resultHash: bytes32(0),
            status: Status.Funded
        });
        emit OrderFunded(orderId, digest, quote.seller, quote.price, quote.conversationHash);
    }

    function deliver(uint256 orderId, bytes32 resultHash) external {
        Order storage order = orders[orderId];
        if (msg.sender != order.seller) revert NotSeller();
        if (order.status != Status.Funded || resultHash == bytes32(0)) revert InvalidState();
        if (block.timestamp > order.deadline) revert QuoteExpired();
        order.resultHash = resultHash;
        order.reviewDeadline = block.timestamp + REVIEW_WINDOW;
        order.status = Status.Delivered;
        emit ResultDelivered(orderId, resultHash, order.reviewDeadline);
    }

    function accept(uint256 orderId) external onlyBuyerAgent nonReentrant {
        Order storage order = orders[orderId];
        if (order.status != Status.Delivered) revert InvalidState();
        order.status = Status.Paid;
        (bool ok, ) = payable(order.seller).call{value: order.price}("");
        if (!ok) revert TransferFailed();
        emit OrderPaid(orderId, order.seller, order.price);
    }

    function finalizeAfterReview(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.status != Status.Delivered) revert InvalidState();
        if (block.timestamp < order.reviewDeadline) revert ReviewWindowNotReached();
        order.status = Status.Paid;
        (bool ok, ) = payable(order.seller).call{value: order.price}("");
        if (!ok) revert TransferFailed();
        emit OrderPaid(orderId, order.seller, order.price);
    }

    function dispute(uint256 orderId) external onlyBuyerAgent {
        Order storage order = orders[orderId];
        if (order.status != Status.Delivered || block.timestamp >= order.reviewDeadline) revert InvalidState();
        order.status = Status.Disputed;
        emit OrderDisputed(orderId);
    }

    function refundExpired(uint256 orderId) external {
        Order storage order = orders[orderId];
        if (order.status != Status.Funded) revert InvalidState();
        if (block.timestamp <= order.deadline) revert DeadlineNotReached();
        _refund(orderId, order);
    }

    function resolveDispute(uint256 orderId, bool paySeller) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter();
        Order storage order = orders[orderId];
        if (order.status != Status.Disputed) revert InvalidState();
        if (paySeller) {
            order.status = Status.Paid;
            (bool ok, ) = payable(order.seller).call{value: order.price}("");
            if (!ok) revert TransferFailed();
            emit OrderPaid(orderId, order.seller, order.price);
        } else {
            _refund(orderId, order);
        }
    }

    function _refund(uint256 orderId, Order storage order) private {
        order.status = Status.Refunded;
        availableBudget += order.price;
        usedAllowance -= order.price;
        emit OrderRefunded(orderId, order.price);
    }
}
