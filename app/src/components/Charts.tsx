"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { DEFAULT_LAUNCH_PARAMS, LAMPORTS_PER_SOL, TOKEN_UNIT } from "@liq/sdk";
import { fmtPrice, fmtSol, timeAgo } from "@/lib/format";
import type { PricePoint } from "@/lib/market";

const H = 280;
const PAD = { l: 8, r: 64, t: 16, b: 26 };

function useWidth(fallback: number) {
  const [w, setW] = useState(fallback);
  const ro = useRef<ResizeObserver | null>(null);
  // Callback ref so the observer follows whichever element is mounted.
  const ref = useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver(([e]) => e && setW(Math.max(240, e.contentRect.width)));
    ro.current.observe(el);
  }, []);
  return [ref, w] as const;
}

/** Price history as a glowing liquid area, with buy/sell droplets and a hover readout. */
export function PriceChart({ history, hue }: { history: PricePoint[]; hue: number }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth(640);

  const geo = useMemo(() => {
    if (history.length < 2) return null;
    const t0 = history[0]!.t;
    const t1 = Math.max(history[history.length - 1]!.t, t0 + 1);
    const prices = history.map((p) => p.price);
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    const span = hi - lo || hi * 0.1 || 1e-12;
    lo = Math.max(0, lo - span * 0.12);
    hi += span * 0.12;
    // Trade-indexed x axis: every ripple gets room, quiet stretches don't flatten the chart.
    const n = history.length - 1;
    const xAt = (i: number) => PAD.l + (i / n) * (W - PAD.l - PAD.r);
    const y = (p: number) => PAD.t + (1 - (p - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const pts = history.map((p, i) => [xAt(i), y(p.price)] as const);
    // Step-after line: price holds until the next trade.
    let line = `M${pts[0]![0]},${pts[0]![1]}`;
    for (let i = 1; i < pts.length; i++) line += ` H${pts[i]![0]} V${pts[i]![1]}`;
    const area = `${line} V${H - PAD.b} H${pts[0]![0]} Z`;
    return { pts, line, area, lo, hi, t0, t1, y };
  }, [history, W]);

  if (!geo) {
    return (
      <div ref={ref} className="chart-wrap" style={{ display: "grid", placeItems: "center" }}>
        <span className="muted">Waiting for the first ripple…</span>
      </div>
    );
  }

  const c = `hsl(${hue} 92% 62%)`;
  const last = history[history.length - 1]!;
  const hv = hover !== null ? history[hover] : null;
  const hp = hover !== null ? geo.pts[hover] : null;

  return (
    <div ref={ref} className="chart-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const mx = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0;
          geo.pts.forEach((p, i) => {
            if (Math.abs(p[0] - mx) < Math.abs(geo.pts[best]![0] - mx)) best = i;
          });
          setHover(best);
        }}
      >
        <defs>
          <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={c} stopOpacity="0.38" />
            <stop offset="1" stopColor={c} stopOpacity="0" />
          </linearGradient>
          <filter id={`glow-${id}`} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * (H - PAD.t - PAD.b)} y2={PAD.t + f * (H - PAD.t - PAD.b)} stroke="rgba(160,200,255,0.07)" />
        ))}
        <path d={geo.area} fill={`url(#area-${id})`} />
        <path d={geo.line} fill="none" stroke={c} strokeWidth="2" filter={`url(#glow-${id})`} />
        {geo.pts.slice(-60).map((p, i) => {
          const pt = history[history.length - Math.min(60, history.length) + i]!;
          if (pt.sol === 0) return null;
          return <circle key={i} cx={p[0]} cy={p[1]} r={Math.min(6, 1.5 + Math.sqrt(pt.sol) * 1.4)} fill={pt.isBuy ? "#6ff7d2" : "#ff5c8a"} opacity="0.65" />;
        })}
        {Math.abs(geo.y(last.price) - (PAD.t + 6)) > 16 && (
          <text x={W - PAD.r + 8} y={PAD.t + 10} fill="#56627d" fontSize="11" fontFamily="var(--mono)">
            {fmtPrice(geo.hi)}
          </text>
        )}
        {Math.abs(geo.y(last.price) - (H - PAD.b - 4)) > 16 && (
          <text x={W - PAD.r + 8} y={H - PAD.b} fill="#56627d" fontSize="11" fontFamily="var(--mono)">
            {fmtPrice(geo.lo)}
          </text>
        )}
        <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(last.price)} y2={geo.y(last.price)} stroke={c} strokeDasharray="3 4" opacity="0.5" />
        <text x={W - PAD.r + 8} y={geo.y(last.price) + 4} fill={c} fontSize="11.5" fontFamily="var(--mono)">
          {fmtPrice(last.price)}
        </text>
        <text x={PAD.l} y={H - 6} fill="#56627d" fontSize="11" fontFamily="var(--mono)">
          {timeAgo(geo.t0)} ago
        </text>
        <text x={W - PAD.r} y={H - 6} fill="#56627d" fontSize="11" fontFamily="var(--mono)" textAnchor="end">
          now
        </text>
        {hp && hv && (
          <g pointerEvents="none">
            <line x1={hp[0]} x2={hp[0]} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.25)" />
            <circle cx={hp[0]} cy={hp[1]} r="4.5" fill={c} stroke="#04060c" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hv && hp && (
        <div
          className="mono"
          style={{
            position: "absolute",
            top: 8,
            left: Math.min(W - 230, Math.max(0, hp[0] - 115)),
            padding: "6px 10px",
            borderRadius: 8,
            background: "rgba(10,15,29,0.92)",
            border: "1px solid var(--line-strong)",
            fontSize: 12,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {fmtPrice(hv.price)} SOL · <span className={hv.isBuy ? "pour" : "drain"}>{hv.sol > 0 ? `${hv.isBuy ? "+" : "−"}${fmtSol(hv.sol)} SOL` : "launch"}</span> · {timeAgo(hv.t)} ago
        </div>
      )}
    </div>
  );
}

/** The bonding curve itself: price vs SOL raised, with your pour highlighted. */
export function CurveChart({ devBuySol, hue }: { devBuySol: number; hue: number }) {
  const id = useId().replace(/:/g, "");
  const p = DEFAULT_LAUNCH_PARAMS;
  const VS = Number(p.initialVirtualSol) / Number(LAMPORTS_PER_SOL);
  const VT = Number(p.initialVirtualTokens) / Number(TOKEN_UNIT);
  const CS = Number(p.curveSupply) / Number(TOKEN_UNIT);
  const k = VS * VT;
  const raisedAt = (sold: number) => k / (VT - sold) - VS;
  const priceAt = (sold: number) => k / (VT - sold) ** 2;
  const maxRaise = raisedAt(CS);
  const maxPrice = priceAt(CS);
  const w = 420;
  const h = 200;
  const x = (r: number) => 10 + (r / maxRaise) * (w - 20);
  const y = (pr: number) => h - 22 - (pr / maxPrice) * (h - 44);

  const samples = Array.from({ length: 80 }, (_, i) => (CS * i) / 79);
  const line = samples.map((s, i) => `${i ? "L" : "M"}${x(raisedAt(s))},${y(priceAt(s))}`).join(" ");
  const devRaise = Math.min(devBuySol, maxRaise);
  const devSold = VT - k / (VS + devRaise);
  const fillSamples = samples.filter((s) => s <= devSold).concat(devSold);
  const fillPath =
    devRaise > 0
      ? `M${x(0)},${h - 22} ` + fillSamples.map((s) => `L${x(raisedAt(s))},${y(priceAt(s))}`).join(" ") + ` L${x(devRaise)},${h - 22} Z`
      : "";
  const devLine = fillSamples.map((s, i) => `${i ? "L" : "M"}${x(raisedAt(s))},${y(priceAt(s))}`).join(" ");
  const c = `hsl(${hue} 92% 62%)`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Bonding curve preview">
      <defs>
        <linearGradient id={`cf-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c} stopOpacity="0.55" />
          <stop offset="1" stopColor={c} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <line x1="10" x2={w - 10} y1={h - 22} y2={h - 22} stroke="rgba(160,200,255,0.12)" />
      {fillPath && <path d={fillPath} fill={`url(#cf-${id})`} />}
      <path d={line} fill="none" stroke="rgba(233,242,255,0.28)" strokeWidth="1.8" />
      {devRaise > 0 && <path d={devLine} fill="none" stroke={c} strokeWidth="2.6" />}
      <circle cx={x(maxRaise)} cy={y(maxPrice)} r="5" fill="#d4ff4f" />
      <text x={x(maxRaise) - 8} y={y(maxPrice) + 4} fill="#d4ff4f" fontSize="11" textAnchor="end" fontFamily="var(--mono)">
        overflow → permanent pool
      </text>
      {devRaise > 0 && (
        <>
          <circle cx={x(devRaise)} cy={y(priceAt(devSold))} r="4.5" fill={c} stroke="#04060c" strokeWidth="2" />
          <text x={x(devRaise) + 8} y={y(priceAt(devSold)) - 8} fill={c} fontSize="11" fontFamily="var(--mono)">
            your pour
          </text>
        </>
      )}
      <text x="10" y={h - 6} fill="#56627d" fontSize="10.5" fontFamily="var(--mono)">
        0 SOL
      </text>
      <text x={w - 10} y={h - 6} fill="#56627d" fontSize="10.5" textAnchor="end" fontFamily="var(--mono)">
        {fmtSol(maxRaise, 0)} SOL raised
      </text>
    </svg>
  );
}
