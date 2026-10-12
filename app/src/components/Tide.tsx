"use client";

import Link from "next/link";
import { useMarket } from "./Providers";
import { fmtSol, shortAddr } from "@/lib/format";
import type { FeedEvent } from "@/lib/market";

function Item({ ev, you }: { ev: FeedEvent; you?: string }) {
  return (
    <Link href={`/t/${ev.mint}`} className="tide-item">
      {ev.kind === "trade" && (
        <>
          <span className={ev.isBuy ? "pour" : "drain"}>{ev.isBuy ? "▲ poured" : "▼ drained"}</span>
          <b className="mono">{fmtSol(ev.sol)} SOL</b>
          <span>{ev.isBuy ? "into" : "from"}</span>
          <b>${ev.symbol}</b>
          <span className="mono">· {ev.trader === you ? "you" : shortAddr(ev.trader)}</span>
        </>
      )}
      {ev.kind === "launch" && (
        <>
          <span className="spill">✦ new vessel</span>
          <b>${ev.symbol}</b>
          <span className="mono">by {ev.trader === you ? "you" : shortAddr(ev.trader)}</span>
        </>
      )}
      {ev.kind === "overflow" && (
        <>
          <span className="spill">◆ OVERFLOW</span>
          <b>${ev.symbol}</b>
          <span>locked</span>
          <b className="mono">{fmtSol(ev.sol)} SOL</b>
          <span>forever</span>
        </>
      )}
    </Link>
  );
}

/** Marquee of live trades, launches and overflows across every pool. */
export function Tide() {
  const { feed, wallet } = useMarket();
  const items = feed.slice(0, 24);
  if (items.length === 0) return <div className="tide" style={{ height: 37 }} />;
  return (
    <div className="tide" aria-label="Live activity">
      <div className="tide-track">
        {[...items, ...items].map((ev, i) => (
          <Item key={`${ev.id}-${i}`} ev={ev} you={wallet.address} />
        ))}
      </div>
    </div>
  );
}
