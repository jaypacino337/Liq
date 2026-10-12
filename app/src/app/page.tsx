"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fillLevel } from "@liq/sdk";
import { useMarket, useMode } from "@/components/Providers";
import { TokenCard } from "@/components/TokenCard";
import { Vessel } from "@/components/Vessel";
import { fmtCompact, fmtSol, lamportsToSol } from "@/lib/format";
import type { TokenView } from "@/lib/market";

type Tab = "hot" | "new" | "near" | "pools";
const TABS: Array<[Tab, string]> = [
  ["hot", "Rippling"],
  ["new", "Fresh"],
  ["near", "Near overflow"],
  ["pools", "Overflowed"],
];

const lastTrade = (t: TokenView) => t.history[t.history.length - 1]?.t ?? Number(t.pool.launchedAt) * 1000;

function HeroVessel() {
  // A demo vessel that fills, overflows, and drains again on a loop.
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % 14), 900);
    return () => clearInterval(id);
  }, []);
  const fill = phase < 11 ? phase / 10 : 1;
  const over = phase >= 11 && phase < 13;
  return (
    <div className="hero-main" style={{ position: "relative" }}>
      <Vessel fill={fill} hue={160} overflowed={over} size={250} />
      <div className="hero-side" style={{ position: "absolute", left: -110, top: 150, transform: "rotate(-10deg)" }}>
        <Vessel fill={0.35} hue={300} size={86} />
      </div>
      <div className="hero-side" style={{ position: "absolute", right: -120, top: 210, transform: "rotate(8deg)" }}>
        <Vessel fill={0.7} hue={40} size={96} />
      </div>
    </div>
  );
}

export default function Home() {
  const market = useMarket();
  const { mode, setMode, resetSandbox } = useMode();
  const [tab, setTab] = useState<Tab>("hot");
  const [q, setQ] = useState("");

  const stats = useMemo(() => {
    let locked = 0n;
    let volume = 0n;
    let overflowed = 0;
    for (const t of market.tokens) {
      volume += t.pool.volumeLamports;
      if (t.pool.phase === "pool") {
        locked += t.pool.realSol;
        overflowed++;
      }
    }
    return { locked, volume, overflowed };
  }, [market.tokens]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let xs = market.tokens.filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.symbol.toLowerCase().includes(needle) || t.mint === q.trim());
    if (tab === "hot") xs = [...xs].sort((a, b) => lastTrade(b) - lastTrade(a));
    if (tab === "new") xs = [...xs].sort((a, b) => Number(b.pool.launchedAt - a.pool.launchedAt));
    if (tab === "near") xs = xs.filter((t) => t.pool.phase === "curve").sort((a, b) => fillLevel(b.pool) - fillLevel(a.pool));
    if (tab === "pools") xs = xs.filter((t) => t.pool.phase === "pool").sort((a, b) => Number(b.pool.realSol - a.pool.realSol));
    return xs;
  }, [market.tokens, tab, q]);

  return (
    <>
      <section className="hero">
        <div>
          <h1>
            Every token starts as a <span className="grad-text">drop</span>.
          </h1>
          <p className="lede">
            Launch in one click. Buyers pour SOL into your token&apos;s vessel along a bonding curve. When it overflows, the curve becomes a
            permanent pool with <b style={{ color: "var(--ink)" }}>no LP tokens</b>, so nobody can pull the liquidity. Not the creator, not us.
          </p>
          <div className="hero-cta">
            <Link href="/launch" className="btn btn-primary">
              Launch a token
            </Link>
            <Link href="/how" className="btn btn-ghost">
              How overflow works
            </Link>
          </div>
          <div className="hero-stats">
            <div className="stat">
              <span className="stat-label">Vessels</span>
              <span className="stat-value">{market.tokens.length}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Locked forever</span>
              <span className="stat-value grad-text">{fmtSol(lamportsToSol(stats.locked), 1)} SOL</span>
            </div>
            <div className="stat">
              <span className="stat-label">Overflowed</span>
              <span className="stat-value">{stats.overflowed}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Volume</span>
              <span className="stat-value">{fmtCompact(lamportsToSol(stats.volume))} SOL</span>
            </div>
          </div>
          {mode === "sandbox" && (
            <div className="sandbox-banner">
              <span>
                ✦ <b>Sandbox mode</b>: a live simulation running the program&apos;s exact math in your browser, with fake SOL. Flip to{" "}
                {process.env.NEXT_PUBLIC_CLUSTER ?? "devnet"} once the program is deployed.
              </span>
              <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12, whiteSpace: "nowrap" }} onClick={resetSandbox}>
                Reset
              </button>
            </div>
          )}
        </div>
        <div className="hero-art">
          <HeroVessel />
        </div>
      </section>

      <div className="section-head">
        <h2>Vessels</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input className="input" style={{ width: 220, padding: "9px 14px" }} placeholder="Search name, ticker, mint" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="tabs" role="tablist">
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {market.error ? (
        <div className="empty">
          <p>{market.error}</p>
          <button className="btn btn-ghost" onClick={() => setMode("sandbox")}>
            Explore the sandbox instead
          </button>
        </div>
      ) : !market.ready ? (
        <div className="empty">Filling the vessels…</div>
      ) : list.length === 0 ? (
        <div className="empty">
          {tab === "pools" ? "Nothing has overflowed yet. Be the pour that tips one over." : "No vessels here yet."}{" "}
          <Link href="/launch" className="grad-text">
            Launch one →
          </Link>
        </div>
      ) : (
        <div className="grid">
          {list.map((t) => (
            <TokenCard key={t.mint} t={t} now={market.now} />
          ))}
        </div>
      )}

      <div className="section-head">
        <h2>The life of a token</h2>
      </div>
      <div className="how">
        <div className="how-step">
          <div className="n">01 · DROP</div>
          <h3>Launch for pennies</h3>
          <p>Name it, pick an image, optionally make the first pour yourself in the same transaction. Fixed 1B supply, mint authority renounced on creation.</p>
        </div>
        <div className="how-step">
          <div className="n">02 · FILL</div>
          <h3>Pour along the curve</h3>
          <p>Price rises smoothly as SOL pours in. A short calm-waters window caps early buys so bots can&apos;t swallow the launch. Sells are never paused.</p>
        </div>
        <div className="how-step">
          <div className="n">03 · OVERFLOW</div>
          <h3>Liquidity, locked by math</h3>
          <p>At ~85 SOL the curve sells out and reopens as a constant-product pool at the exact same price. No LP tokens are minted, so no one can withdraw.</p>
        </div>
      </div>
    </>
  );
}
