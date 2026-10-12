import { LAMPORTS_PER_SOL, LiqMathError, TOKEN_UNIT } from "@liq/sdk";

export const lamportsToSol = (l: bigint) => Number(l) / Number(LAMPORTS_PER_SOL);
export const solToLamports = (s: number) => BigInt(Math.floor(s * Number(LAMPORTS_PER_SOL)));
export const tokensToUi = (t: bigint) => Number(t) / Number(TOKEN_UNIT);
export const uiToTokens = (t: number) => BigInt(Math.floor(t * Number(TOKEN_UNIT)));

export function fmtSol(sol: number, digits = 2): string {
  if (sol === 0) return "0";
  if (Math.abs(sol) < 0.001) return sol.toExponential(1);
  if (Math.abs(sol) < 1) return sol.toFixed(Math.max(digits, 3));
  return sol.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtCompact(n: number): string {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: n < 100 ? 2 : 1 }).format(n);
}

/** Tiny SOL prices: 0.0000000284 → "0.0₇284" */
export function fmtPrice(p: number): string {
  if (!(p > 0)) return "0";
  if (p >= 0.001) return p.toPrecision(4);
  const exp = Math.floor(Math.log10(p));
  const zeros = -exp - 1;
  const digits = Math.round(p * 10 ** (-exp + 2));
  const sub = String(zeros)
    .split("")
    .map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)])
    .join("");
  return `0.0${sub}${digits}`;
}

export const shortAddr = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Stable hue per mint for the token's "liquid" colour. */
export function hueFor(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

const PROGRAM_ERRORS: Record<number, string> = {
  6001: "Launches and buys are paused right now.",
  6008: "Amount is too small.",
  6009: "Price moved past your slippage limit. Try again or raise slippage.",
  6010: "Calm waters: buys are capped for the first moments after launch.",
  6011: "Not enough liquidity for that trade.",
  6012: "No creator fees to claim yet.",
};

export function friendlyError(e: unknown): string {
  if (e instanceof LiqMathError) {
    if (e.message === "ZeroAmount") return "Amount is too small.";
    if (e.message === "InsufficientLiquidity") return "Not enough liquidity for that trade.";
  }
  const msg = e instanceof Error ? e.message : String(e);
  const custom = /custom program error: 0x([0-9a-f]+)/i.exec(msg) ?? /"Custom":(\d+)/.exec(msg);
  if (custom?.[1]) {
    const code = custom[0].includes("0x") ? parseInt(custom[1], 16) : Number(custom[1]);
    if (PROGRAM_ERRORS[code]) return PROGRAM_ERRORS[code]!;
  }
  if (/User rejected|rejected the request/i.test(msg)) return "Cancelled in wallet.";
  if (/insufficient (funds|lamports)/i.test(msg)) return "Not enough SOL in your wallet.";
  return msg.length > 160 ? msg.slice(0, 160) + "…" : msg;
}
