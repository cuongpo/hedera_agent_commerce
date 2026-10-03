import Link from "next/link";
import { mirrorContractResult, mirrorMessage, readReceipt } from "../lib/trade";
import OfficeReplay, { type OfficeTrade } from "./OfficeReplay";

export const dynamic = "force-dynamic";

export default function Home() {
  const trade = readReceipt();
  const officeTrade: OfficeTrade | null = trade
    ? {
        buyerAccountId: trade.buyer.accountId,
        orderId: trade.orderId,
        taskValues: trade.task.records.map((record) => record.value),
        offers: trade.offers.map((offer) => ({
          accountId: offer.sellerAccountId,
          price: offer.price,
          selected: offer.sellerAccountId === trade.selectedSellerAccountId,
          proofUrl: mirrorMessage(offer.topicId, offer.sequence),
        })),
        purchaseUrl: mirrorContractResult(trade.transactions.purchase),
        awardUrl: mirrorMessage(trade.conversationTopicId, trade.awardSequence),
        deliveryUrl: mirrorMessage(
          trade.conversationTopicId,
          trade.deliverySequence,
        ),
        deliveryTxUrl: mirrorContractResult(trade.transactions.delivery),
        payoutUrl: mirrorContractResult(trade.transactions.payout),
      }
    : null;
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <span>AGENT COMMERCE</span>
        </div>
        <span className="network-pill">
          <span className="status-dot" /> HEDERA TESTNET
        </span>
      </header>
      <section className="hero">
        <div className="eyebrow">
          SCAFFOLD-HBAR TEMPLATE · HCS-10 + SMART CONTRACTS
        </div>
        <h1>
          Agents that can <em>buy work</em>
          <br />
          from other agents.
        </h1>
        <p>
          A buyer discovers providers, compares signed quotes, spends within a
          fixed budget, checks delivery, and settles in HBAR. The entire trade
          is inspectable.
        </p>
        <div className="hero-actions">
          <Link className="button primary" href="/verify">
            Verify the trade <span>↗</span>
          </Link>
          <a
            className="button ghost"
            href="https://hol.org/docs/standards/hcs-10/"
            target="_blank"
            rel="noreferrer"
          >
            How HCS-10 works ↗
          </a>
        </div>
      </section>

      <OfficeReplay trade={officeTrade} />

      {trade ? (
        <>
          <section className="grid two">
            <article className="card">
              <div className="card-label">BUYER AGENT</div>
              <h3>{trade.buyer.accountId}</h3>
              <p>Autonomous procurement with an on-chain spending limit.</p>
              <code>{trade.buyer.evmAddress}</code>
            </article>
            <article className="card accent">
              <div className="card-label">SETTLED ORDER</div>
              <h3>#{trade.orderId}</h3>
              <p>
                Seller {trade.selectedSellerAccountId} completed the task and
                received HBAR.
              </p>
              <a
                href={mirrorContractResult(trade.transactions.payout)}
                target="_blank"
                rel="noreferrer"
              >
                View payout on mirror node ↗
              </a>
            </article>
          </section>
          <section className="section-head">
            <div>
              <div className="eyebrow">PRICE DISCOVERY</div>
              <h2>Quotes from registered sellers</h2>
            </div>
          </section>
          <div className="quote-list">
            {trade.offers.map((offer) => (
              <article className="quote-row" key={offer.sellerAccountId}>
                <div>
                  <span className="seller-name">{offer.sellerAccountId}</span>
                  <span className="minor">
                    HCS topic {offer.topicId} · message #{offer.sequence}
                  </span>
                </div>
                <div className="quote-end">
                  <strong>
                    {(Number(BigInt(offer.price)) / 1e8).toFixed(3)} HBAR
                  </strong>
                  <span
                    className={
                      offer.sellerAccountId === trade.selectedSellerAccountId
                        ? "tag selected"
                        : "tag"
                    }
                  >
                    {offer.sellerAccountId === trade.selectedSellerAccountId
                      ? "SELECTED"
                      : "VALID QUOTE"}
                  </span>
                  <a
                    href={mirrorMessage(offer.topicId, offer.sequence)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Proof ↗
                  </a>
                </div>
              </article>
            ))}
          </div>
          <section className="proof-strip">
            <div>
              <div className="eyebrow">PUBLIC EVIDENCE</div>
              <h2>Inspect every step</h2>
              <p>
                Quote and delivery messages are on HCS. Funding, delivery
                commitment, and payout are contract transactions.
              </p>
            </div>
            <div className="proof-links">
              <a
                href={mirrorContractResult(trade.transactions.purchase)}
                target="_blank"
                rel="noreferrer"
              >
                Funding ↗
              </a>
              <a
                href={mirrorMessage(
                  trade.conversationTopicId,
                  trade.deliverySequence,
                )}
                target="_blank"
                rel="noreferrer"
              >
                Delivery message ↗
              </a>
              <a
                href={mirrorContractResult(trade.transactions.payout)}
                target="_blank"
                rel="noreferrer"
              >
                Payout ↗
              </a>
            </div>
          </section>
        </>
      ) : (
        <section className="empty-state">
          <div className="empty-icon">⌁</div>
          <div>
            <h2>Ready for the first trade</h2>
            <p>
              The template builds without credentials. Fund a testnet operator,
              then run the setup, deploy, and demo commands in the README.
              Completed trades appear here automatically.
            </p>
            <code>
              npm run agents:setup → npm run hardhat:deploy -- --network
              hederaTestnet → npm run agents:demo
            </code>
          </div>
        </section>
      )}
      <footer>
        AGENT COMMERCE STARTER{" "}
        <span>
          HCS-10 conversation · bounded HBAR escrow · independent verification
        </span>
      </footer>
    </main>
  );
}
