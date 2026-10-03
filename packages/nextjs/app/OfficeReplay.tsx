"use client";

import { useEffect, useState } from "react";

export type OfficeTrade = {
  buyerAccountId: string;
  orderId: number;
  taskValues: number[];
  offers: {
    accountId: string;
    price: string;
    selected: boolean;
    proofUrl: string;
  }[];
  purchaseUrl: string;
  awardUrl: string;
  deliveryUrl: string;
  deliveryTxUrl: string;
  payoutUrl: string;
};

const steps = [
  { label: "Discover", icon: "⌕" },
  { label: "Request", icon: "↗" },
  { label: "Quotes", icon: "↙" },
  { label: "Fund", icon: "◇" },
  { label: "Deliver", icon: "▣" },
  { label: "Pay", icon: "✦" },
] as const;

const movements = [
  {
    medium: "HCS-10 DISCOVERY",
    from: "BUYER",
    verb: "CHECKS REGISTRY",
    to: "SELLERS A + B",
  },
  {
    medium: "HCS-10 MESSAGE",
    from: "BUYER",
    verb: "SENDS RFQ",
    to: "SELLERS A + B",
  },
  {
    medium: "HCS-10 + SIGNATURE",
    from: "SELLERS A + B",
    verb: "SEND QUOTES",
    to: "BUYER",
  },
  {
    medium: "SMART CONTRACT",
    from: "BUYER",
    verb: "BUYS SERVICE",
    to: "ESCROW",
  },
  {
    medium: "HCS-10 + CONTRACT",
    from: "SELLER B",
    verb: "DELIVERS RESULT",
    to: "BUYER + ESCROW",
  },
  {
    medium: "SMART CONTRACT",
    from: "ESCROW",
    verb: "SENDS HBAR",
    to: "SELLER B",
  },
] as const;

function displayPrice(tinybar: string) {
  return `${(Number(BigInt(tinybar)) / 1e8).toFixed(2)} HBAR`;
}

function AgentSprite({ role }: { role: "buyer" | "seller-a" | "seller-b" }) {
  return (
    <div className={`office-sprite ${role}`} aria-hidden="true">
      <span className="sprite-hair" />
      <span className="sprite-face" />
      <span className="sprite-shirt" />
      <span className="sprite-legs" />
    </div>
  );
}

export default function OfficeReplay({ trade }: { trade: OfficeTrade | null }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const offers = trade?.offers.slice(0, 2) ?? [
    { accountId: "SELLER A", price: "5000000", selected: false, proofUrl: "" },
    { accountId: "SELLER B", price: "3000000", selected: true, proofUrl: "" },
  ];
  const selected = offers.find((offer) => offer.selected) ?? offers[1];
  const selectedName =
    offers.findIndex((offer) => offer.selected) === 0 ? "SELLER A" : "SELLER B";
  const selectedIndex = selectedName === "SELLER A" ? 0 : 1;
  const selectedRow = selectedIndex === 0 ? 80 : 260;
  const values = trade?.taskValues ?? [4, 6, 8];
  const sum = values.reduce((total, value) => total + value, 0);
  const otherOffer = offers.find((offer) => !offer.selected) ?? offers[0];
  const outcomes = [
    "2 providers found",
    `Task: count, sum, average of ${values.join(", ")}`,
    `${selectedName} wins: ${displayPrice(selected.price)} < ${displayPrice(otherOffer.price)}`,
    `${displayPrice(selected.price)} locked in escrow`,
    `Validated: ${values.length} values, sum ${sum}, average ${sum / values.length}`,
    `${displayPrice(selected.price)} paid`,
  ];
  const movement = {
    ...movements[step],
    from: step === 4 ? selectedName : movements[step].from,
    to: step === 5 ? selectedName : movements[step].to,
    result: outcomes[step],
  };
  const buyerState = [
    "SEARCHING FOR SERVICE",
    "RFQ SENT TO BOTH",
    "COMPARING SIGNED QUOTES",
    "ORDER PLACED",
    "CHECKING RESULT",
    "ORDER COMPLETE",
  ][step];
  const buyerScreen = ["FIND", "RFQ", "PICK", "BUY", "CHECK", "DONE"][step];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPlaying(false);
    }
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (step === steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setStep(step + 1), 2200);
    return () => window.clearTimeout(timer);
  }, [playing, step]);

  const details = [
    {
      title: "The buyer finds two sellers",
      body: "The buyer reads the HCS-10 registry, then checks seller profiles and EVM aliases before opening a conversation with each seller.",
      links: [] as { label: string; href: string }[],
    },
    {
      title: "One task goes to both desks",
      body: `The buyer sends an RFQ over each HCS-10 connection. Both sellers receive the same public values: ${values.join(", ")}. They quote for calculating count, sum, and average.`,
      links: trade
        ? [
            {
              label: "Open HCS conversation ↗",
              href: selected.proofUrl.replace(/\/messages\/\d+$/, "/messages"),
            },
          ]
        : [],
    },
    {
      title: "Two signed prices come back",
      body: `Seller A offers ${displayPrice(offers[0].price)}; seller B offers ${displayPrice(offers[1].price)}. The buyer checks both signatures and selects ${selectedName} (${selected.accountId}).`,
      links: trade
        ? offers.map((offer, index) => ({
            label: `Seller ${index === 0 ? "A" : "B"} quote ↗`,
            href: offer.proofUrl,
          }))
        : [],
    },
    {
      title: "Escrow locks the agreed price",
      body: `The buyer submits the selected signed quote. The contract commits ${displayPrice(selected.price)} from the owner's bounded budget to the new order${trade ? ` #${trade.orderId}` : ""}.`,
      links: trade
        ? [
            { label: "Purchase transaction ↗", href: trade.purchaseUrl },
            { label: "HCS award message ↗", href: trade.awardUrl },
          ]
        : [],
    },
    {
      title: "Seller delivers; buyer checks",
      body: "The selected seller posts the artifact on HCS and commits its hash on-chain. The buyer recalculates the result before accepting it.",
      links: trade
        ? [
            { label: "Delivery message ↗", href: trade.deliveryUrl },
            { label: "Hash commitment ↗", href: trade.deliveryTxUrl },
          ]
        : [],
    },
    {
      title: "HBAR reaches the seller",
      body: `After the buyer accepts, the contract pays ${displayPrice(selected.price)} to ${selected.accountId}. The verifier independently checks the recorded trade.`,
      links: trade
        ? [{ label: "Payout transaction ↗", href: trade.payoutUrl }]
        : [],
    },
  ];

  function chooseStep(next: number) {
    setPlaying(false);
    setStep(next);
  }

  return (
    <section className="office-replay" aria-labelledby="office-title">
      <div className="office-heading">
        <div>
          <div className="eyebrow">AGENT COMMERCE OFFICE</div>
          <h2 id="office-title">Watch a task become a paid order.</h2>
          <p>
            {trade
              ? `Replay of completed testnet order #${trade.orderId}, using its local public receipt.`
              : "Illustrative walkthrough. Run the demo to replay your own testnet trade here."}
          </p>
        </div>
        <span className="office-mode">
          {trade ? "TESTNET REPLAY" : "DEMO PREVIEW"}
        </span>
      </div>

      <div className={`office-scene office-step-${step}`}>
        <div className="office-scene-top">
          <span>COMMERCE FLOOR / 01</span>
          <span>HCS-10 + HBAR ESCROW</span>
        </div>
        <div className="office-action" aria-live="polite">
          <span className="office-action-medium">{movement.medium}</span>
          <div className="office-action-path">
            <strong>{movement.from}</strong>
            <span className="office-action-arrow">
              <small>{movement.verb}</small>
              <b aria-hidden="true">━━━━→</b>
            </span>
            <strong>{movement.to}</strong>
          </div>
          <span className="office-action-result">{movement.result}</span>
        </div>
        <svg
          className="office-routes"
          viewBox="0 0 1000 350"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="office-hcs-arrow"
              markerWidth="9"
              markerHeight="9"
              refX="8"
              refY="4.5"
              orient="auto"
            >
              <path d="M0 0 L9 4.5 L0 9 Z" fill="#7ee1c3" />
            </marker>
            <marker
              id="office-hbar-arrow"
              markerWidth="9"
              markerHeight="9"
              refX="8"
              refY="4.5"
              orient="auto"
            >
              <path d="M0 0 L9 4.5 L0 9 Z" fill="#eab877" />
            </marker>
          </defs>
          {(step <= 2 ? [0, 1] : step === 4 ? [selectedIndex] : []).map(
            (index) => {
              const row = index === 0 ? 80 : 260;
              const returnsToBuyer = step === 2 || step === 4;
              return (
                <path
                  key={index}
                  className="office-route route-rfq active"
                  d={
                    returnsToBuyer
                      ? `M650 ${row} H640 V176 H350`
                      : `M350 176 H640 V${row} H650`
                  }
                  markerEnd="url(#office-hcs-arrow)"
                />
              );
            },
          )}
          {step === 3 && (
            <path
              className="office-route route-budget active"
              d="M350 228 H370"
              markerEnd="url(#office-hbar-arrow)"
            />
          )}
          {step >= 4 && (
            <path
              className="office-route route-settle active"
              d={
                step === 4
                  ? `M650 ${selectedRow} H635 V228 H630`
                  : `M630 228 H635 V${selectedRow} H650`
              }
              markerEnd="url(#office-hbar-arrow)"
            />
          )}
        </svg>
        <div className="office-floor">
          <div
            className={`office-station office-buyer ${step <= 3 ? "active" : ""}`}
          >
            <div className="station-eyebrow">01 / PROCUREMENT</div>
            <div className="office-desk">
              <span className="office-screen">{buyerScreen}</span>
              <AgentSprite role="buyer" />
            </div>
            <strong>Buyer agent</strong>
            <small>{trade?.buyerAccountId ?? "Finds and buys work"}</small>
            <span className="station-event">{buyerState}</span>
            <span className="station-pill">0.10 HBAR limit</span>
          </div>

          <div className={`office-hub ${step < 3 ? "hcs" : "escrow"}`}>
            <div className="hub-symbol">{step < 3 ? "◎" : "◇"}</div>
            <strong>
              {step === 0
                ? "HCS-10 REGISTRY"
                : step < 3
                  ? "HCS-10 CHANNELS"
                  : "ESCROW"}
            </strong>
            <span>
              {step === 0
                ? "Agents discoverable"
                : step === 1
                  ? "RFQs recorded"
                  : step === 2
                    ? "Quotes recorded"
                    : step === 3
                      ? `${displayPrice(selected.price)} locked`
                      : step === 4
                        ? "Result hash stored"
                        : "Seller paid"}
            </span>
            <small>
              {step < 3 ? "Hedera public topics" : "AgentCommerce.sol"}
            </small>
          </div>

          <div className="office-sellers">
            {offers.map((offer, index) => (
              <div
                className={`office-station office-seller ${offer.selected && step >= 2 ? "selected" : ""} ${step <= 2 || (offer.selected && step >= 4) ? "active" : ""}`}
                key={offer.accountId}
              >
                <div className="station-eyebrow">
                  0{index + 2} / {index === 0 ? "SELLER A" : "SELLER B"}
                </div>
                <div className="seller-desk-row">
                  <AgentSprite role={index === 0 ? "seller-a" : "seller-b"} />
                  <span className="office-screen">
                    {step < 2 ? "ID" : index === 0 ? "A" : "B"}
                  </span>
                  {step >= 2 && (
                    <span className="office-price">
                      {displayPrice(offer.price)}
                    </span>
                  )}
                </div>
                <small>{offer.accountId}</small>
                <span className="station-event">
                  {step === 0
                    ? "REGISTERED PROVIDER"
                    : step === 1
                      ? "REQUEST RECEIVED"
                      : step === 2
                        ? "SIGNED QUOTE SENT"
                        : !offer.selected
                          ? "NOT SELECTED"
                          : step === 3
                            ? "AWARD RECEIVED"
                            : step === 4
                              ? "RESULT DELIVERED"
                              : "HBAR RECEIVED"}
                </span>
                {offer.selected && step >= 2 && (
                  <span className="chosen-label">✓ CHOSEN SELLER</span>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="office-scene-bottom">
          <span>{step < 3 ? "MESSAGES ON HCS" : "SETTLEMENT ON HEDERA"}</span>
          <span>{String(step + 1).padStart(2, "0")} / 06</span>
        </div>
      </div>

      <div className="office-controls">
        <div className="office-steps" aria-label="Choose a trade stage">
          {steps.map((item, index) => (
            <button
              type="button"
              key={item.label}
              className={`office-step-button ${index === step ? "current" : ""} ${index < step ? "complete" : ""}`}
              onClick={() => chooseStep(index)}
              aria-current={index === step ? "step" : undefined}
            >
              <span className="office-step-number">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="office-play"
          onClick={() => {
            if (playing) {
              setPlaying(false);
            } else {
              if (step === steps.length - 1) setStep(0);
              setPlaying(true);
            }
          }}
        >
          {playing
            ? "Pause replay"
            : step === steps.length - 1
              ? "Replay again ↻"
              : "Play replay ▶"}
        </button>
      </div>

      <div className="office-detail" aria-live="polite">
        <div className="office-detail-index">
          STEP {String(step + 1).padStart(2, "0")}
        </div>
        <div>
          <h3>{details[step].title}</h3>
          <p>{details[step].body}</p>
          {details[step].links.length > 0 && (
            <div className="office-detail-links">
              {details[step].links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
