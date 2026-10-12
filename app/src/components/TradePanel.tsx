"use client";

import { useEffect, useMemo, useState } from "react";
import { applyBuy, applySell, buyCost, quoteBuy, quoteSell, sellPayout, spotPrice, type TradeOutcome } from "@liq/sdk";
import { useMarket } from "./Providers";
import { friendlyError, fmtCompact, fmtPrice, fmtSol, lamportsToSol, solToLamports, tokensToUi, uiToTokens } from "@/lib/format";
import type { TokenView } from "@/lib/market";

const SLIPPAGES = [50, 100, 300];

export function TradePanel({ t }: { t: TokenView }) {
  const market = useMarket();
  const [side, setSide] = useState<"pour" | "drain">("pour");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(100);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const pool = t.pool;
  const held = market.holdings[t.mint] ?? 0n;
  const lamports = market.wallet.lamports ?? 0n;
  const calmEnds = Number(pool.launchedAt + pool.params.calmPeriodSecs);
  const inCalm = pool.phase === "curve" && now < calmEnds;

  const quote = useMemo((): { o: TradeOutcome; impact: number; error?: string } | { error: string } | null => {
    const n = Number(amount);
    if (!amount || !Number.isFinite(n) || n <= 0) return null;
    try {
      if (side === "pour") {
        const o = quoteBuy(pool, solToLamports(n));
        const impact = spotPrice(applyBuy(pool, o)) / spotPrice(pool) - 1;
        let error: string | undefined;
        if (inCalm && o.sol > pool.params.calmMaxBuyLamports) error = `Calm waters: max ${fmtSol(lamportsToSol(pool.params.calmMaxBuyLamports))} SOL per pour for ${calmEnds - now}s.`;
        else if (market.wallet.connected && buyCost(o) > lamports) error = "Not enough SOL in your wallet.";
        return { o, impact, error };
      }
      const tokens = uiToTokens(n);
      const o = quoteSell(pool, tokens);
      const impact = spotPrice(applySell(pool, o)) / spotPrice(pool) - 1;
      return { o, impact, error: market.wallet.connected && tokens > held ? `You hold ${fmtCompact(tokensToUi(held))} ${t.symbol}.` : undefined };
    } catch (e) {
      return { error: friendlyError(e) };
    }
  }, [amount, side, pool, inCalm, calmEnds, now, lamports, held, market.wallet.connected, t.symbol]);

  async function submit() {
    if (!market.wallet.connected) return market.connect?.();
    setBusy(true);
    setMsg(null);
    try {
      const n = Number(amount);
      if (side === "pour") {
        await market.buy(t.mint, solToLamports(n), slippage);
        setMsg({ kind: "ok", text: `Poured ${fmtSol(n)} SOL into $${t.symbol}.` });
      } else {
        const tokens = uiToTokens(n) > held ? held : uiToTokens(n);
        await market.sell(t.mint, tokens, slippage);
        setMsg({ kind: "ok", text: `Drained ${fmtCompact(n)} $${t.symbol}.` });
      }
      setAmount("");
    } catch (e) {
      setMsg({ kind: "err", text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }

  const q = quote && "o" in quote ? quote : null;
  const err = quote?.error;

  return (
    <div className="panel">
      <div className="trade-tabs" role="tablist">
        <button role="tab" className="t-pour" aria-selected={side === "pour"} onClick={() => (setSide("pour"), setAmount(""))}>
          Pour
        </button>
        <button role="tab" className="t-drain" aria-selected={side === "drain"} onClick={() => (setSide("drain"), setAmount(""))}>
          Drain
        </button>
      </div>

      {pool.phase === "pool" ? (
        <div className="notice notice-pool">◆ Overflowed. Trading against permanent liquidity: no LP tokens exist, so it can never be pulled.</div>
      ) : inCalm ? (
        <div className="notice notice-calm">≈ Calm waters for {calmEnds - now}s. Each pour is capped at {fmtSol(lamportsToSol(pool.params.calmMaxBuyLamports))} SOL so snipers can&apos;t swallow the launch.</div>
      ) : null}

      <div className="amount-box">
        <input
          className="input"
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          aria-label={side === "pour" ? "SOL to pour" : "Tokens to drain"}
        />
        <span className="amount-unit">{side === "pour" ? "SOL" : t.symbol.slice(0, 6)}</span>
      </div>

      <div className="presets">
        {side === "pour"
          ? ["0.1", "0.5", "1", "5"].map((v) => (
              <button key={v} onClick={() => setAmount(v)}>
                {v} SOL
              </button>
            ))
          : [25, 50, 75, 100].map((pct) => (
              <button key={pct} onClick={() => setAmount(String(tokensToUi((held * BigInt(pct)) / 100n)))} disabled={held === 0n}>
                {pct}%
              </button>
            ))}
      </div>

      {q && (
        <div className="quote mono">
          {side === "pour" ? (
            <>
              <div className="quote-row">
                <span>You receive</span>
                <span>
                  {fmtCompact(tokensToUi(q.o.tokens))} {t.symbol}
                </span>
              </div>
              <div className="quote-row">
                <span>Total cost</span>
                <span>{fmtSol(lamportsToSol(buyCost(q.o)), 4)} SOL</span>
              </div>
            </>
          ) : (
            <div className="quote-row">
              <span>You receive</span>
              <span>{fmtSol(lamportsToSol(sellPayout(q.o)), 4)} SOL</span>
            </div>
          )}
          <div className="quote-row">
            <span>Avg price</span>
            <span>{fmtPrice(lamportsToSol(q.o.sol) / Math.max(tokensToUi(q.o.tokens), 1e-12))} SOL</span>
          </div>
          <div className="quote-row">
            <span>Price impact</span>
            <span style={{ color: Math.abs(q.impact) > 0.05 ? "var(--warn)" : undefined }}>{(q.impact * 100).toFixed(2)}%</span>
          </div>
          <div className="quote-row">
            <span>Fees (protocol + creator)</span>
            <span>{fmtSol(lamportsToSol(q.o.protocolFee + q.o.creatorFee), 5)} SOL</span>
          </div>
          {q.o.overflows && (
            <div className="quote-row" style={{ color: "var(--lime)" }}>
              <span style={{ color: "inherit" }}>◆ This pour overflows the vessel</span>
              <span>refund {fmtSol(lamportsToSol(solToLamports(Number(amount)) - buyCost(q.o)), 3)}</span>
            </div>
          )}
        </div>
      )}

      {err && <div className="notice notice-err">{err}</div>}
      {msg && <div className={`notice notice-${msg.kind}`}>{msg.text}</div>}

      <button
        className={`btn btn-block ${side === "pour" ? "btn-primary" : "btn-drain"}`}
        disabled={busy || (market.wallet.connected && (!q || !!err))}
        onClick={submit}
      >
        {!market.wallet.connected ? "Connect wallet" : busy ? "Confirming…" : side === "pour" ? `Pour into $${t.symbol}` : `Drain $${t.symbol}`}
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, fontSize: 12 }} className="muted">
        <span className="mono">
          {side === "pour" ? `${fmtSol(lamportsToSol(lamports), 3)} SOL` : `${fmtCompact(tokensToUi(held))} ${t.symbol}`} available
        </span>
        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
          slippage
          {SLIPPAGES.map((s) => (
            <button
              key={s}
              onClick={() => setSlippage(s)}
              className="mono"
              style={{
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: "2px 6px",
                fontSize: 11,
                background: slippage === s ? "rgba(111,247,210,0.12)" : "transparent",
                color: slippage === s ? "var(--liq)" : "var(--muted)",
              }}
            >
              {s / 100}%
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
