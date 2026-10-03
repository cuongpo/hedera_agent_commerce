import Link from "next/link";
import {
  mirrorContractResult,
  readReceipt,
  verifyTrade,
  type Check,
} from "../../lib/trade";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const trade = readReceipt();
  let checks: Check[] = [];
  let error = "";
  if (trade) {
    try {
      checks = await verifyTrade(trade);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : "Verification failed";
    }
  }
  const passed = checks.length > 0 && checks.every((check) => check.passed);
  return (
    <main className="shell verify-shell">
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark">◈</span>
          <span>AGENT COMMERCE</span>
        </Link>
        <span className="network-pill">
          <span className="status-dot" /> HEDERA TESTNET
        </span>
      </header>
      <div className="eyebrow">INDEPENDENT VERIFIER</div>
      <h1>
        Trust the evidence.
        <br />
        <em>Check the trade.</em>
      </h1>
      <p className="verify-intro">
        This page reads HCS messages from the Hedera mirror node and escrow
        state from the JSON-RPC relay, then checks signatures, hashes,
        identities, and payment status.
      </p>
      {!trade ? (
        <div className="card">
          <h2>No trade receipt yet</h2>
          <p>
            Run the setup and demo commands in the README, then return here.
          </p>
        </div>
      ) : (
        <>
          <div
            className={
              passed ? "result-banner success" : "result-banner failure"
            }
          >
            <span>{passed ? "✓" : "!"}</span>
            <div>
              <strong>
                {passed
                  ? "All checks passed"
                  : error
                    ? "Verification unavailable"
                    : "A check failed"}
              </strong>
              <small>
                Order #{trade.orderId} · {trade.contractAddress}
              </small>
            </div>
          </div>
          {error && <div className="error-note">{error}</div>}
          <div className="check-list">
            {checks.map((check) => (
              <div className="check-row" key={check.label}>
                <span
                  className={
                    check.passed ? "check-icon pass" : "check-icon fail"
                  }
                >
                  {check.passed ? "✓" : "×"}
                </span>
                <div>
                  <strong>{check.label}</strong>
                  <small>{check.detail}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="verify-footer">
            <a
              className="button ghost"
              href={mirrorContractResult(trade.transactions.payout)}
              target="_blank"
              rel="noreferrer"
            >
              View payout ↗
            </a>
            <Link className="button primary" href="/">
              Back to overview
            </Link>
          </div>
        </>
      )}
      <p className="footnote">
        This proves the recorded terms, delivery bytes, and settlement state. It
        does not prove subjective work quality. The demo task uses an objective
        validator.
      </p>
    </main>
  );
}
