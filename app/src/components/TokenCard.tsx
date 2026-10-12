"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fillLevel, lamportsToOverflow, marketCapSol } from "@liq/sdk";
import { Vessel } from "./Vessel";
import { TokenOrb } from "./TokenOrb";
import { fmtCompact, fmtSol, lamportsToSol, timeAgo } from "@/lib/format";
import type { TokenView } from "@/lib/market";

export function phaseBadge(t: TokenView, now: number) {
  if (t.pool.phase === "pool") return <span className="badge badge-pool">◆ Permanent pool</span>;
  if (now < Number(t.pool.launchedAt + t.pool.params.calmPeriodSecs)) return <span className="badge badge-calm">≈ Calm waters</span>;
  if (fillLevel(t.pool) > 0.8) return <span className="badge badge-hot">● Near overflow</span>;
  return null;
}

export function TokenCard({ t, now }: { t: TokenView; now: number }) {
  const fill = fillLevel(t.pool);
  const overflowed = t.pool.phase === "pool";
  // Ripple the card whenever a new trade lands.
  const [flash, setFlash] = useState(false);
  const lastCount = useRef(t.pool.tradeCount);
  useEffect(() => {
    if (t.pool.tradeCount !== lastCount.current) {
      lastCount.current = t.pool.tradeCount;
      setFlash(true);
      const id = setTimeout(() => setFlash(false), 900);
      return () => clearTimeout(id);
    }
  }, [t.pool.tradeCount]);

  return (
    <Link href={`/t/${t.mint}`} className={`card${flash ? " flash" : ""}`} style={{ "--hue": t.hue } as CSSProperties}>
      <Vessel fill={fill} hue={t.hue} overflowed={overflowed} size={76} bubbles={fill > 0.05} />
      <div className="card-body">
        <div className="card-top">
          <TokenOrb hue={t.hue} image={t.image} symbol={t.symbol} size={22} />
          <span className="card-name">{t.name}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="ticker">${t.symbol}</span>
          {phaseBadge(t, now)}
        </div>
        {t.description && <div className="card-desc">{t.description}</div>}
        <div className="meter" aria-label="Curve progress">
          <span style={{ width: `${Math.max(2, fill * 100)}%` }} />
        </div>
        <div className="card-meta mono">
          <span>MC {fmtCompact(marketCapSol(t.pool))}</span>
          <span>{overflowed ? `◆ ${fmtSol(lamportsToSol(t.pool.realSol), 1)} SOL locked` : `${fmtSol(lamportsToSol(lamportsToOverflow(t.pool)), 1)} SOL to spill`}</span>
        </div>
        <div className="card-meta">
          <span>{t.pool.tradeCount.toString()} trades</span>
          <span>{timeAgo(Number(t.pool.launchedAt) * 1000, now * 1000)} old</span>
        </div>
      </div>
    </Link>
  );
}
