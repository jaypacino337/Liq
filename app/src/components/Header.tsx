"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useMarket, useMode } from "./Providers";
import { fmtSol, lamportsToSol } from "@/lib/format";

// Wallet button touches window; render client-only.
const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), { ssr: false });

export function LiqMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="liq-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6ff7d2" />
          <stop offset="1" stopColor="#d4ff4f" />
        </linearGradient>
      </defs>
      <path d="M16 2 C16 2 5 14.5 5 21 a11 11 0 0 0 22 0 C27 14.5 16 2 16 2Z" fill="url(#liq-mark)" />
      <path d="M10 21.5 c2-1.6 4-1.6 6 0 s4 1.6 6 0" stroke="#04110c" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="11.5" cy="15" r="1.8" fill="#fff" opacity="0.7" />
    </svg>
  );
}

export function Header() {
  const path = usePathname();
  const { mode, setMode } = useMode();
  const market = useMarket();

  const link = (href: string, label: string) => (
    <Link href={href} aria-current={path === href ? "page" : undefined}>
      {label}
    </Link>
  );

  return (
    <header className="header">
      <div className="shell header-row">
        <Link href="/" className="brand">
          <LiqMark />
          <span>liq</span>
        </Link>
        <nav className="nav">
          {link("/", "Pools")}
          {link("/launch", "Launch")}
          {link("/how", "How it works")}
        </nav>
        <div className="header-right">
          <Link href="/launch" className="btn btn-primary mobile-only" style={{ padding: "8px 14px", fontSize: 13 }}>
            Launch
          </Link>
          <div className="mode-switch" role="group" aria-label="Network">
            <button aria-pressed={mode === "sandbox"} onClick={() => setMode("sandbox")}>
              Sandbox
            </button>
            <button aria-pressed={mode === "chain"} onClick={() => setMode("chain")}>
              {process.env.NEXT_PUBLIC_CLUSTER ?? "Devnet"}
            </button>
          </div>
          {mode === "sandbox" ? (
            <button className="chip" onClick={market.refill} title="Sandbox SOL is simulated. Click to refill.">
              <span className="dot" />
              <span className="mono">{fmtSol(lamportsToSol(market.wallet.lamports ?? 0n))} SOL</span>
            </button>
          ) : (
            <WalletMultiButton />
          )}
        </div>
      </div>
    </header>
  );
}
