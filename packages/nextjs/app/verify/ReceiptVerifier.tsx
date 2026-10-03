"use client";

import { useState, type FormEvent } from "react";
import exampleReceipt from "../../data/public-trade.json";
import type { Check } from "../../lib/trade";

const exampleReceiptText = JSON.stringify(exampleReceipt, null, 2);

type Result = {
  orderId: number;
  contractAddress: string;
  payout: string;
  checks: Check[];
};

export default function ReceiptVerifier() {
  const [receiptText, setReceiptText] = useState(exampleReceiptText);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);

    let receipt: unknown;
    try {
      receipt = JSON.parse(receiptText);
    } catch {
      setError("Enter a valid JSON receipt.");
      return;
    }
    if (
      !receipt ||
      typeof receipt !== "object" ||
      !("network" in receipt) ||
      receipt.network !== "testnet" ||
      !("offers" in receipt)
    ) {
      setError(
        "Paste the public last-trade.json receipt from a completed testnet run.",
      );
      return;
    }
    if (new TextEncoder().encode(receiptText).length > 16_384) {
      setError("Receipt is too large (16 KB maximum).");
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: receiptText,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verification failed.");
      setResult(data as Result);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Verification failed.",
      );
    } finally {
      setPending(false);
    }
  }

  const passed =
    result !== null &&
    result.checks.length > 0 &&
    result.checks.every((check) => check.passed);

  return (
    <section
      className="receipt-verifier"
      aria-labelledby="receipt-verifier-title"
    >
      <div className="eyebrow">VERIFY A PUBLIC RECEIPT</div>
      <h2 id="receipt-verifier-title">Check a trade yourself.</h2>
      <p>
        A public example is ready below. Click Verify receipt, or replace it
        with <code>.local/last-trade.json</code> from your own completed testnet
        run. Never paste <code>.env</code> or <code>.local/agents.json</code>.{" "}
        <a
          href="https://github.com/cuongpo/hedera_agent_commerce/blob/main/packages/nextjs/data/public-trade.json"
          target="_blank"
          rel="noreferrer"
        >
          View example format ↗
        </a>
      </p>
      <form onSubmit={submit}>
        <label htmlFor="receipt-json">Public trade receipt (JSON)</label>
        <textarea
          id="receipt-json"
          value={receiptText}
          onChange={(event) => setReceiptText(event.target.value)}
          rows={8}
          required
          spellCheck={false}
        />
        <div className="receipt-actions">
          <button className="button primary" type="submit" disabled={pending}>
            {pending ? "Checking Hedera..." : "Verify receipt"}
          </button>
          <button
            className="button ghost"
            type="button"
            disabled={pending}
            onClick={() => {
              setReceiptText(exampleReceiptText);
              setResult(null);
              setError("");
            }}
          >
            Restore example
          </button>
        </div>
      </form>
      <div aria-live="polite">
        {error && <p className="error-note">{error}</p>}
        {result && (
          <div className="submitted-result">
            <div
              className={
                passed ? "result-banner success" : "result-banner failure"
              }
            >
              <span>{passed ? "✓" : "!"}</span>
              <div>
                <strong>
                  {passed ? "All checks passed" : "A check failed"}
                </strong>
                <small>
                  Order #{result.orderId} · {result.contractAddress} ·{" "}
                  {result.checks.filter((check) => check.passed).length}/
                  {result.checks.length} passed
                </small>
              </div>
            </div>
            <div className="check-list">
              {result.checks.map((check) => (
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
                href={`https://testnet.mirrornode.hedera.com/api/v1/contracts/results/${result.payout}`}
                target="_blank"
                rel="noreferrer"
              >
                View payout ↗
              </a>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
