import Link from "next/link";
import { DEFAULT_LAUNCH_PARAMS, LAMPORTS_PER_SOL, TOKEN_UNIT } from "@liq/sdk";

const p = DEFAULT_LAUNCH_PARAMS;
const sol = (l: bigint) => Number(l) / Number(LAMPORTS_PER_SOL);
const tok = (t: bigint) => (Number(t) / Number(TOKEN_UNIT)).toLocaleString("en-US");
// SOL raised when the curve sells out: k / (VT - curve) - VS.
const OVERFLOW_SOL = Math.round(
  (sol(p.initialVirtualSol) * Number(p.initialVirtualTokens)) / Number(p.initialVirtualTokens - p.curveSupply) - sol(p.initialVirtualSol),
);

export const metadata = { title: "How it works — liq" };

function Lifecycle() {
  // drop → filling vessel → overflow → permanent pool
  const stage = (x: number, label: string, sub: string, fill: number, over = false) => (
    <g transform={`translate(${x} 0)`}>
      <path d="M38,30 H62 V48 C62,54 88,62 88,86 V122 C88,132 80,136 70,136 H30 C20,136 12,132 12,122 V86 C12,62 38,54 38,48 Z" fill="rgba(160,200,255,0.05)" stroke="rgba(233,242,255,0.35)" strokeWidth="1.6" />
      {fill > 0.05 && <rect x="14" y={136 - fill * 74} width="72" height={fill * 74 - 2} rx="10" fill="url(#lc)" opacity="0.9" />}
      {over && <path d="M36,30 C24,30 28,44 32,50 M64,30 C76,30 72,44 68,50" stroke="#6ff7d2" strokeWidth="3.5" fill="none" strokeLinecap="round" />}
      <text x="50" y="164" textAnchor="middle" fill="#e9f2ff" fontSize="13" fontFamily="var(--font-display)" fontWeight="600">
        {label}
      </text>
      <text x="50" y="182" textAnchor="middle" fill="#8794b0" fontSize="11">
        {sub}
      </text>
    </g>
  );
  return (
    <svg viewBox="0 0 640 196" width="100%" role="img" aria-label="Token lifecycle: launch, fill, overflow, permanent pool">
      <defs>
        <linearGradient id="lc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6ff7d2" />
          <stop offset="1" stopColor="#1f8f9a" />
        </linearGradient>
      </defs>
      {stage(10, "Launch", "1B minted, authority burned", 0)}
      {stage(180, "Fill", "price climbs the curve", 0.55)}
      {stage(350, "Overflow", `~${OVERFLOW_SOL} SOL raised`, 1, true)}
      {stage(520, "Pool", "no LP · can't be pulled", 1)}
      {[120, 290, 460].map((x) => (
        <path key={x} d={`M${x},86 h40 m-8,-6 l8,6 l-8,6`} stroke="#56627d" strokeWidth="1.6" fill="none" />
      ))}
      <g transform="translate(570 20)">
        <rect width="54" height="22" rx="11" fill="rgba(212,255,79,0.12)" stroke="#d4ff4f" />
        <text x="27" y="15" textAnchor="middle" fill="#d4ff4f" fontSize="11" fontFamily="var(--font-mono)">
          LOCKED
        </text>
      </g>
    </svg>
  );
}

export default function HowPage() {
  return (
    <div style={{ padding: "36px 0 20px", maxWidth: 980 }}>
      <h1 style={{ fontFamily: "var(--display)", fontSize: "clamp(34px,5vw,56px)", letterSpacing: "-0.04em", margin: "0 0 12px" }}>
        Liquidity that <span className="grad-text">can&apos;t be pulled</span>.
      </h1>
      <p className="muted" style={{ fontSize: 18, lineHeight: 1.6, maxWidth: 720 }}>
        Most launchpads graduate a token by handing its liquidity to someone: a migration wallet, an LP token holder, a DAO. Liq doesn&apos;t.
        When a curve sells out, the program reopens it as a constant-product pool it owns outright, and{" "}
        <b style={{ color: "var(--ink)" }}>never mints LP tokens</b>. There&apos;s no withdraw instruction, so there&apos;s nothing to rug.
      </p>

      <div className="panel" style={{ margin: "28px 0" }}>
        <Lifecycle />
      </div>

      <div className="how">
        <div className="how-step">
          <div className="n">PHASE 1 · CURVE</div>
          <h3>Virtual reserves</h3>
          <p>
            Prices come from x·y=k on {sol(p.initialVirtualSol)} SOL of virtual liquidity against {tok(p.initialVirtualTokens)} virtual tokens. {tok(p.curveSupply)} real tokens
            are for sale; the rest is held back.
          </p>
        </div>
        <div className="how-step">
          <div className="n">THE MOMENT · OVERFLOW</div>
          <h3>Same price, new engine</h3>
          <p>
            The buy that empties the curve is trimmed to exactly what&apos;s left (you&apos;re refunded the rest). The program seeds the pool with just enough reserve tokens to
            match the closing price, and burns the remainder.
          </p>
        </div>
        <div className="how-step">
          <div className="n">PHASE 2 · POOL</div>
          <h3>Real reserves, forever</h3>
          <p>
            The same buy and sell instructions keep working, now priced on real reserves. Fees still accrue to the creator. Every lamport stays in the pool
            account.
          </p>
        </div>
      </div>

      <h2 style={{ fontFamily: "var(--display)", letterSpacing: "-0.03em" }}>Guarantees enforced by the program</h2>
      <ul className="promise-list">
        <li>
          <span className="pour">◆</span>
          <div>
            <b>Fixed supply</b>Mint authority is set to none in the launch transaction. There is no freeze authority.
          </div>
        </li>
        <li>
          <span className="pour">◆</span>
          <div>
            <b>Exits are never paused</b>An admin can pause launches and buys in an emergency. Sells always work.
          </div>
        </li>
        <li>
          <span className="pour">◆</span>
          <div>
            <b>Calm waters</b>For the first {p.calmPeriodSecs.toString()}s, each buy is capped at {sol(p.calmMaxBuyLamports)} SOL so one sniper can&apos;t swallow the launch.
          </div>
        </li>
        <li>
          <span className="pour">◆</span>
          <div>
            <b>Fee ceiling</b>Fees are hard-capped at 5% in the program, and each pool snapshots its fees at launch. Config changes never touch live markets.
          </div>
        </li>
        <li>
          <span className="pour">◆</span>
          <div>
            <b>Creator fees can&apos;t block trading</b>The creator&apos;s {p.creatorFeeBps / 100}% accrues inside the pool and is claimed separately, so an empty wallet can&apos;t jam swaps.
          </div>
        </li>
        <li>
          <span className="pour">◆</span>
          <div>
            <b>Always solvent</b>Pool lamports always equal rent + reserves + unclaimed creator fees. The test suite checks this after every trade.
          </div>
        </li>
      </ul>

      <div className="panel" style={{ marginBottom: 40 }}>
        <h3 className="panel-title">Default parameters</h3>
        <div className="quote mono" style={{ margin: 0 }}>
          {[
            ["Total supply", tok(p.totalSupply)],
            ["Sold on curve", tok(p.curveSupply)],
            ["Virtual SOL", `${sol(p.initialVirtualSol)} SOL`],
            ["Protocol fee", `${p.protocolFeeBps / 100}%`],
            ["Creator fee", `${p.creatorFeeBps / 100}%`],
            ["Graduation fee", `${sol(p.graduationFeeLamports)} SOL`],
            ["Calm waters", `${p.calmPeriodSecs}s · ${sol(p.calmMaxBuyLamports)} SOL / buy`],
          ].map(([k, v]) => (
            <div className="quote-row" key={k}>
              <span>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 40 }}>
        <Link href="/launch" className="btn btn-primary">
          Launch a token
        </Link>
        <Link href="/" className="btn btn-ghost">
          Browse pools
        </Link>
      </div>
    </div>
  );
}
