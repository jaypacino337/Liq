"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { PublicKey } from "@solana/web3.js";
import { fillLevel, lamportsToOverflow, marketCapSol, spotPrice } from "@liq/sdk";
import { useMarket } from "@/components/Providers";
import { Vessel } from "@/components/Vessel";
import { TokenOrb } from "@/components/TokenOrb";
import { PriceChart } from "@/components/Charts";
import { TradePanel } from "@/components/TradePanel";
import { phaseBadge } from "@/components/TokenCard";
import { isSandboxCreator } from "@/lib/sandbox";
import { fmtCompact, fmtPrice, fmtSol, friendlyError, lamportsToSol, shortAddr, timeAgo, tokensToUi } from "@/lib/format";
import type { TokenView } from "@/lib/market";

function CreatorPanel({ t }: { t: TokenView }) {
  const market = useMarket();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const mine =
    market.mode === "sandbox"
      ? isSandboxCreator(t.pool)
      : !!market.wallet.address && t.pool.creator.equals(new PublicKey(market.wallet.address));
  if (!mine) return null;
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3 className="panel-title">Your vessel</h3>
      <div className="quote-row mono" style={{ marginBottom: 12 }}>
        <span className="muted">Unclaimed creator fees</span>
        <span className="grad-text">{fmtSol(lamportsToSol(t.pool.creatorFeesUnclaimed), 4)} SOL</span>
      </div>
      <div className="quote-row mono" style={{ marginBottom: 14, fontSize: 13 }}>
        <span className="muted">Earned all-time</span>
        <span>{fmtSol(lamportsToSol(t.pool.creatorFeesTotal), 4)} SOL</span>
      </div>
      <button
        className="btn btn-ghost btn-block"
        disabled={busy || t.pool.creatorFeesUnclaimed === 0n}
        onClick={async () => {
          setBusy(true);
          setMsg(undefined);
          try {
            await market.claim(t.mint);
            setMsg("Claimed.");
          } catch (e) {
            setMsg(friendlyError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Claiming…" : "Claim fees"}
      </button>
      {msg && <p className="hint" style={{ marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}

export default function TokenPage() {
  const { mint } = useParams<{ mint: string }>();
  const market = useMarket();
  const t = market.tokens.find((x) => x.mint === mint);
  const { watch } = market;

  useEffect(() => {
    if (mint) watch(mint);
  }, [mint, watch]);

  if (!t) {
    return (
      <div className="empty" style={{ margin: "40px 0" }}>
        {market.ready ? (
          <>
            This vessel doesn&apos;t exist {market.mode === "sandbox" ? "in the sandbox" : "on this cluster"}. <Link href="/" className="grad-text">Back to pools →</Link>
          </>
        ) : (
          "Pouring…"
        )}
      </div>
    );
  }

  const p = t.pool;
  const fill = fillLevel(p);
  const overflowed = p.phase === "pool";
  // Recent trades from the token's own history (has every trade, unlike the global feed).
  const trades = t.history.filter((h) => h.sol > 0).slice(-30).reverse();
  const held = market.holdings[t.mint] ?? 0n;

  return (
    <div className="token-layout" style={{ "--hue": t.hue } as CSSProperties}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 20, minWidth: 0 }}>
        <div className="panel token-hero">
          <Vessel fill={fill} hue={t.hue} overflowed={overflowed} size={170} />
          <div style={{ minWidth: 0 }}>
            <div className="token-title">
              <TokenOrb hue={t.hue} image={t.image} symbol={t.symbol} size={44} />
              <h1>{t.name}</h1>
              <span className="ticker" style={{ fontSize: 16 }}>
                ${t.symbol}
              </span>
              {phaseBadge(t, market.now)}
            </div>
            {t.description && <p className="muted" style={{ margin: "10px 0 0", lineHeight: 1.5 }}>{t.description}</p>}
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                <span className="muted">{overflowed ? "Overflowed into a permanent pool" : `Vessel ${(fill * 100).toFixed(1)}% full`}</span>
                <span className="mono">
                  {overflowed
                    ? `${timeAgo(Number(p.graduatedAt) * 1000, market.now * 1000)} ago`
                    : `${fmtSol(lamportsToSol(lamportsToOverflow(p)), 2)} SOL to overflow`}
                </span>
              </div>
              <div className="meter" style={{ height: 10 }}>
                <span style={{ width: `${Math.max(1, fill * 100)}%` }} />
              </div>
            </div>
            <div className="stats-row">
              <div className="stat">
                <span className="stat-label">Price</span>
                <span className="stat-value">{fmtPrice(spotPrice(p))}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Market cap</span>
                <span className="stat-value">{fmtCompact(marketCapSol(p))} SOL</span>
              </div>
              <div className="stat">
                <span className="stat-label">{overflowed ? "Locked SOL" : "Raised"}</span>
                <span className="stat-value">{fmtSol(lamportsToSol(p.realSol), 2)} SOL</span>
              </div>
              <div className="stat">
                <span className="stat-label">Volume</span>
                <span className="stat-value">{fmtCompact(lamportsToSol(p.volumeLamports))} SOL</span>
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-title">Price</h3>
          <PriceChart history={t.history} hue={t.hue} />
        </div>

        <div className="panel">
          <h3 className="panel-title">Ripples</h3>
          {trades.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No recent trades.</p>
          ) : (
            <div className="feed-list">
              {trades.map((f, i) => (
                <div key={`${f.t}-${i}`} className={`feed-row mono${i === 0 ? " new" : ""}`}>
                  <span className={f.isBuy ? "pour" : "drain"}>{f.isBuy ? "POUR" : "DRAIN"}</span>
                  <span className="muted">{!f.trader ? "—" : f.trader === market.wallet.address ? "you" : shortAddr(f.trader)}</span>
                  <span>{fmtSol(f.sol, 3)} SOL</span>
                  <span className="muted" style={{ minWidth: 34, textAlign: "right" }}>
                    {timeAgo(f.t, market.now * 1000)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="trade-col">
        <TradePanel t={t} />
        <CreatorPanel t={t} />
        <div className="panel" style={{ marginTop: 16, fontSize: 13 }}>
          <div className="quote-row" style={{ marginBottom: 8 }}>
            <span className="muted">You hold</span>
            <span className="mono">
              {fmtCompact(tokensToUi(held))} {t.symbol}
            </span>
          </div>
          <div className="quote-row" style={{ marginBottom: 8 }}>
            <span className="muted">Mint</span>
            <span className="mono" title={t.mint}>{shortAddr(t.mint)}</span>
          </div>
          <div className="quote-row" style={{ marginBottom: 8 }}>
            <span className="muted">Creator</span>
            <span className="mono">{market.mode === "sandbox" && isSandboxCreator(p) ? "you" : shortAddr(p.creator.toBase58())}</span>
          </div>
          <div className="quote-row">
            <span className="muted">Fees</span>
            <span className="mono">
              {p.params.protocolFeeBps / 100}% + {p.params.creatorFeeBps / 100}% creator
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
